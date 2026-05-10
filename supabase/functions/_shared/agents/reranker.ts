import { Agent } from "./base.ts";
import type { AgentContext } from "./types.ts";
import { pineconeRerank } from "../pinecone.ts";

const TOP_N = 8;
// bge-reranker-v2-m3 caps at 100 documents per request. Pre-trim by initial
// cosine score before reranking when the router selects many namespaces.
const RERANK_INPUT_CAP = 100;

export class RerankerAgent extends Agent {
  readonly name = "reranker";
  constructor(private readonly pineconeKey: string) {
    super();
  }

  async run(ctx: AgentContext): Promise<void> {
    const { session, emit } = ctx;
    const matches = session.retrieved ?? [];
    if (matches.length === 0) {
      session.reranked = [];
      return;
    }
    if (matches.length <= TOP_N) {
      session.reranked = [...matches].sort((a, b) => b.score - a.score);
      return;
    }

    const span = ctx.trace?.span?.({
      name: "reranker",
      input: { inputCount: matches.length, topN: TOP_N, inputCap: RERANK_INPUT_CAP },
    });

    const candidates = matches.length > RERANK_INPUT_CAP
      ? [...matches].sort((a, b) => b.score - a.score).slice(0, RERANK_INPUT_CAP)
      : matches;

    await emit({
      type: "step",
      text: `Reranking ${candidates.length} chunks → top ${TOP_N}…`,
    });

    try {
      const ranked = await pineconeRerank({
        apiKey: this.pineconeKey,
        query: session.userQuery,
        documents: candidates.map((m) => ({
          text: m.text || textFromMetadata(m.metadata),
        })),
        topN: TOP_N,
        parentSpan: span,
      });
      session.reranked = ranked.map((r) => ({
        ...candidates[r.index],
        score: r.score,
      }));
      span?.end?.({
        output: {
          rerankedCount: session.reranked.length,
          topScore: session.reranked[0]?.score,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      session.errors.push(`reranker: ${msg}`);
      session.reranked = [...matches]
        .sort((a, b) => b.score - a.score)
        .slice(0, TOP_N);
      span?.end?.({
        level: "ERROR",
        statusMessage: msg,
        output: { fallbackToCosine: true, count: session.reranked.length },
      });
    }
  }
}

function textFromMetadata(meta: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof meta.summary === "string") parts.push(meta.summary);
  if (typeof meta.meeting_title === "string") parts.push(String(meta.meeting_title));
  return parts.join("\n").slice(0, 1500);
}
