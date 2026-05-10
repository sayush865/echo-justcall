import { Agent } from "./base.ts";
import type { AgentContext } from "./types.ts";
import { pineconeRerank } from "../pinecone.ts";

const TOP_N = 8;

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

    await emit({
      type: "step",
      text: `Reranking ${matches.length} chunks → top ${TOP_N}…`,
    });

    try {
      const ranked = await pineconeRerank({
        apiKey: this.pineconeKey,
        query: session.userQuery,
        documents: matches.map((m) => ({
          text: m.text || textFromMetadata(m.metadata),
        })),
        topN: TOP_N,
      });
      session.reranked = ranked.map((r) => ({
        ...matches[r.index],
        score: r.score,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      session.errors.push(`reranker: ${msg}`);
      // Fallback: top-N by original cosine score.
      session.reranked = [...matches]
        .sort((a, b) => b.score - a.score)
        .slice(0, TOP_N);
    }
  }
}

function textFromMetadata(meta: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof meta.summary === "string") parts.push(meta.summary);
  if (typeof meta.meeting_title === "string") parts.push(String(meta.meeting_title));
  return parts.join("\n").slice(0, 1500);
}
