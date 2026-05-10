import { Agent } from "./base.ts";
import type { AgentContext, RetrievedMatch } from "./types.ts";
import { embedBatch } from "../openai.ts";
import { pineconeQuery } from "../pinecone.ts";

const TOPK_PER_NAMESPACE = 20;

export class RetrievalAgent extends Agent {
  readonly name = "retrieval";
  constructor(
    private readonly openAiKey: string,
    private readonly pineconeKey: string,
    private readonly pineconeHost: string,
  ) {
    super();
  }

  async run(ctx: AgentContext): Promise<void> {
    const { session, emit } = ctx;
    if (!session.routes?.length) {
      session.retrieved = [];
      return;
    }

    const span = ctx.trace?.span?.({
      name: "retrieval",
      input: {
        routeCount: session.routes.length,
        tools: session.routes.map((r) => r.toolName),
        topK: TOPK_PER_NAMESPACE,
      },
    });

    await emit({
      type: "step",
      text: `Retrieving from ${session.routes.length} namespace(s)…`,
    });

    const queryTexts = session.routes.map((r) => r.searchQuery);
    let embeddings: number[][];
    try {
      embeddings = await embedBatch(queryTexts, this.openAiKey, span);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      session.errors.push(`retrieval/embed: ${msg}`);
      session.retrieved = [];
      span?.end?.({ level: "ERROR", statusMessage: msg });
      return;
    }

    const all: RetrievedMatch[] = [];
    await Promise.all(session.routes.map(async (route, idx) => {
      try {
        const matches = await pineconeQuery({
          host: this.pineconeHost,
          apiKey: this.pineconeKey,
          namespace: route.namespace,
          vector: embeddings[idx],
          topK: TOPK_PER_NAMESPACE,
          parentSpan: span,
        });
        const normalized = matches.map((m: any) =>
          normalizeMatch(m, route.namespace, route.toolName)
        );
        await emit({
          type: "tool",
          toolName: route.toolName,
          result: { matches: normalized.slice(0, 5) },
        });
        all.push(...normalized);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        session.errors.push(`retrieval[${route.toolName}]: ${msg}`);
        await emit({
          type: "tool",
          toolName: route.toolName,
          result: { matches: [], error: msg },
        });
      }
    }));

    session.retrieved = all;
    span?.end?.({ output: { retrievedCount: all.length } });
  }
}

function readMeta(raw: Record<string, any>, key: string): any {
  return raw[key] ?? raw[`metadata.${key}`];
}

function normalizeMatch(
  m: any,
  namespace: string,
  toolName: string,
): RetrievedMatch {
  const raw: Record<string, any> = m.metadata || {};
  const callSID = readMeta(raw, "call_sid") ?? raw.callSID ?? raw.callsid;
  const instanceId =
    readMeta(raw, "instance_sid") ??
    readMeta(raw, "instance_id") ??
    raw.instanceId ??
    raw.instanceid;
  const summary =
    readMeta(raw, "summary_full") ?? readMeta(raw, "summary") ?? raw.summary;
  const text =
    raw.text ??
    readMeta(raw, "text") ??
    readMeta(raw, "content") ??
    readMeta(raw, "transcript") ??
    raw.pageContent ??
    "";
  const meetingTitle = readMeta(raw, "meeting_title");
  const customerName =
    readMeta(raw, "customer_name") ?? readMeta(raw, "customer_names.0");
  const callDate =
    readMeta(raw, "call_date") ??
    readMeta(raw, "instance_date") ??
    readMeta(raw, "meeting_date");
  const direction = readMeta(raw, "direction");
  const sentiment = readMeta(raw, "sentiment") ?? raw.sentiment;
  const tags = readMeta(raw, "tags") ?? readMeta(raw, "tag");

  return {
    id: m.id,
    score: m.score,
    namespace,
    toolName,
    text,
    metadata: {
      ...raw,
      callSID,
      instanceId,
      summary,
      meeting_title: meetingTitle,
      customer_name: customerName,
      call_date: callDate,
      direction,
      sentiment,
      tags,
    },
  };
}
