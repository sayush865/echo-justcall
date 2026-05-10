// Pinecone helpers shared across agents and ingest functions.

const PINECONE_INDEX = "echo";
const API_VERSION = "2025-04";

let cachedIndexHost: string | null = null;

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
}): Promise<any[]> {
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
  return data.matches || [];
}

export async function pineconeUpsert(opts: {
  host: string;
  apiKey: string;
  namespace: string;
  vectors: { id: string; values: number[]; metadata: Record<string, unknown> }[];
}): Promise<void> {
  if (opts.vectors.length === 0) return;
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
}

// Pinecone Inference rerank API. Returns the input matches re-ordered + scored,
// trimmed to top_n.
export async function pineconeRerank<T extends { text?: string }>(opts: {
  apiKey: string;
  query: string;
  documents: T[];
  topN: number;
  model?: string;
}): Promise<{ index: number; score: number }[]> {
  if (opts.documents.length === 0) return [];
  const model = opts.model ?? "bge-reranker-v2-m3";
  const docs = opts.documents.map((d, i) => ({
    id: String(i),
    text: (d.text ?? "").slice(0, 1500),
  }));
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
  return (data.data || []).map((r: { index: number | string; score: number }) => ({
    index: typeof r.index === "string" ? parseInt(r.index, 10) : r.index,
    score: r.score,
  }));
}
