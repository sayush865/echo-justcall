// Pinecone helpers shared across agents and ingest functions. Each call
// optionally attaches a Langfuse span under `parentSpan` to capture latency
// and result counts in the trace tree.

const PINECONE_INDEX = "echo";
const API_VERSION = "2025-04";

let cachedIndexHost: string | null = null;

// deno-lint-ignore no-explicit-any
type ParentSpan = any | null | undefined;

export async function getPineconeIndexHost(apiKey: string): Promise<string> {
  if (cachedIndexHost) return cachedIndexHost;
  const fromEnv = Deno.env.get("PINECONE_INDEX_HOST");
  if (fromEnv) {
    cachedIndexHost = fromEnv.replace(/^https?:\/\//, "");
    return cachedIndexHost;
  }
  const res = await fetch(`https://api.pinecone.io/indexes/${PINECONE_INDEX}`, {
    headers: { "Api-Key": apiKey, "X-Pinecone-API-Version": API_VERSION },
  });
  if (!res.ok) {
    throw new Error(`Pinecone describe-index failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  cachedIndexHost = data.host as string;
  return cachedIndexHost;
}

export async function pineconeQuery(opts: {
  host: string;
  apiKey: string;
  namespace: string;
  vector: number[];
  topK: number;
  parentSpan?: ParentSpan;
}): Promise<any[]> {
  const span = opts.parentSpan?.span?.({
    name: `pinecone-query`,
    input: { namespace: opts.namespace, topK: opts.topK },
  });

  try {
    const res = await fetch(`https://${opts.host}/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Api-Key": opts.apiKey,
        "X-Pinecone-API-Version": API_VERSION,
      },
      body: JSON.stringify({
        namespace: opts.namespace,
        vector: opts.vector,
        topK: opts.topK,
        includeMetadata: true,
        includeValues: false,
      }),
    });
    if (!res.ok) {
      throw new Error(
        `Pinecone query (${opts.namespace}) failed: ${res.status} ${await res.text()}`,
      );
    }
    const data = await res.json();
    const matches = data.matches || [];
    span?.end?.({ output: { matchCount: matches.length } });
    return matches;
  } catch (err) {
    span?.end?.({
      level: "ERROR",
      statusMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function pineconeUpsert(opts: {
  host: string;
  apiKey: string;
  namespace: string;
  vectors: { id: string; values: number[]; metadata: Record<string, unknown> }[];
  parentSpan?: ParentSpan;
}): Promise<void> {
  if (opts.vectors.length === 0) return;
  const span = opts.parentSpan?.span?.({
    name: "pinecone-upsert",
    input: { namespace: opts.namespace, count: opts.vectors.length },
  });
  try {
    for (let i = 0; i < opts.vectors.length; i += 100) {
      const batch = opts.vectors.slice(i, i + 100);
      const res = await fetch(`https://${opts.host}/vectors/upsert`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Api-Key": opts.apiKey,
          "X-Pinecone-API-Version": API_VERSION,
        },
        body: JSON.stringify({ namespace: opts.namespace, vectors: batch }),
      });
      if (!res.ok) {
        throw new Error(`Pinecone upsert failed: ${res.status} ${await res.text()}`);
      }
    }
    span?.end?.({ output: { upserted: opts.vectors.length } });
  } catch (err) {
    span?.end?.({
      level: "ERROR",
      statusMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function pineconeRerank<T extends { text?: string }>(opts: {
  apiKey: string;
  query: string;
  documents: T[];
  topN: number;
  model?: string;
  parentSpan?: ParentSpan;
}): Promise<{ index: number; score: number }[]> {
  if (opts.documents.length === 0) return [];
  const model = opts.model ?? "bge-reranker-v2-m3";
  const span = opts.parentSpan?.span?.({
    name: "pinecone-rerank",
    input: { model, query: opts.query, docCount: opts.documents.length, topN: opts.topN },
  });
  const docs = opts.documents.map((d, i) => ({
    id: String(i),
    text: (d.text ?? "").slice(0, 1500),
  }));
  try {
    const res = await fetch("https://api.pinecone.io/rerank", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Api-Key": opts.apiKey,
        "X-Pinecone-API-Version": API_VERSION,
      },
      body: JSON.stringify({
        model,
        query: opts.query,
        documents: docs,
        top_n: Math.min(opts.topN, docs.length),
        return_documents: false,
      }),
    });
    if (!res.ok) {
      throw new Error(`Pinecone rerank failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    const result = (data.data || []).map((r: { index: number | string; score: number }) => ({
      index: typeof r.index === "string" ? parseInt(r.index, 10) : r.index,
      score: r.score,
    }));
    span?.end?.({ output: { returnedCount: result.length, topScore: result[0]?.score } });
    return result;
  } catch (err) {
    span?.end?.({
      level: "ERROR",
      statusMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
