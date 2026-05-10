// Shared helpers for JustCall → Pinecone ingestion (mirrors the n8n workflows).

const PINECONE_INDEX = "echo";
const EMBED_MODEL = "text-embedding-3-small";
const EMBED_DIMS = 512;
const TOPIC_MODEL = "gpt-4.1-mini";

let cachedIndexHost: string | null = null;

export async function getPineconeIndexHost(apiKey: string): Promise<string> {
  if (cachedIndexHost) return cachedIndexHost;
  const fromEnv = Deno.env.get("PINECONE_INDEX_HOST");
  if (fromEnv) {
    cachedIndexHost = fromEnv.replace(/^https?:\/\//, "");
    return cachedIndexHost;
  }
  const res = await fetch(`https://api.pinecone.io/indexes/${PINECONE_INDEX}`, {
    headers: { "Api-Key": apiKey, "X-Pinecone-API-Version": "2025-04" },
  });
  if (!res.ok) {
    throw new Error(`Pinecone describe-index failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  cachedIndexHost = data.host as string;
  return cachedIndexHost;
}

export async function embedBatch(
  texts: string[],
  apiKey: string,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out: number[][] = [];
  // OpenAI accepts up to 2048 inputs; we batch at 100 for safety/latency.
  for (let i = 0; i < texts.length; i += 100) {
    const slice = texts.slice(i, i + 100);
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: EMBED_MODEL,
        input: slice,
        dimensions: EMBED_DIMS,
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI embed failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    for (const d of data.data) out.push(d.embedding as number[]);
  }
  return out;
}

export async function pineconeUpsert(
  host: string,
  apiKey: string,
  namespace: string,
  vectors: { id: string; values: number[]; metadata: Record<string, unknown> }[],
): Promise<void> {
  if (vectors.length === 0) return;
  // Pinecone upsert limit is 1000 vectors per request; batch at 100 to keep payload small.
  for (let i = 0; i < vectors.length; i += 100) {
    const batch = vectors.slice(i, i + 100);
    const res = await fetch(`https://${host}/vectors/upsert`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Api-Key": apiKey,
        "X-Pinecone-API-Version": "2025-04",
      },
      body: JSON.stringify({ namespace, vectors: batch }),
    });
    if (!res.ok) {
      throw new Error(`Pinecone upsert failed: ${res.status} ${await res.text()}`);
    }
  }
}

// Recursive character text splitter (LangChain-style).
const DEFAULT_SEPARATORS = ["\n\n", "\n", " ", ""];

export function splitText(
  text: string,
  opts: { chunkSize: number; chunkOverlap: number },
): string[] {
  if (!text) return [];
  if (text.length <= opts.chunkSize) return [text];
  return recursiveSplit(text, DEFAULT_SEPARATORS, opts.chunkSize, opts.chunkOverlap);
}

function recursiveSplit(
  text: string,
  separators: string[],
  chunkSize: number,
  overlap: number,
): string[] {
  let separator = separators[separators.length - 1];
  let nextSeparators: string[] = [];
  for (let i = 0; i < separators.length; i++) {
    const sep = separators[i];
    if (sep === "" || text.includes(sep)) {
      separator = sep;
      nextSeparators = separators.slice(i + 1);
      break;
    }
  }

  const splits = separator === "" ? text.split("") : text.split(separator);
  const goodSplits: string[] = [];
  const finalChunks: string[] = [];

  for (const s of splits) {
    if (s.length < chunkSize) {
      goodSplits.push(s);
    } else {
      if (goodSplits.length) {
        finalChunks.push(...mergeSplits(goodSplits, separator, chunkSize, overlap));
        goodSplits.length = 0;
      }
      if (nextSeparators.length === 0) {
        finalChunks.push(s);
      } else {
        finalChunks.push(...recursiveSplit(s, nextSeparators, chunkSize, overlap));
      }
    }
  }
  if (goodSplits.length) {
    finalChunks.push(...mergeSplits(goodSplits, separator, chunkSize, overlap));
  }
  return finalChunks;
}

function mergeSplits(
  splits: string[],
  separator: string,
  chunkSize: number,
  overlap: number,
): string[] {
  const docs: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  const join = (parts: string[]) => parts.join(separator);

  for (const s of splits) {
    const sepLen = current.length > 0 ? separator.length : 0;
    if (currentLen + s.length + sepLen > chunkSize && current.length > 0) {
      docs.push(join(current));
      while (
        currentLen > overlap ||
        (currentLen + s.length + sepLen > chunkSize && current.length > 0)
      ) {
        const removed = current.shift();
        if (!removed) break;
        currentLen -= removed.length + (current.length > 0 ? separator.length : 0);
      }
    }
    current.push(s);
    currentLen += s.length + sepLen;
  }
  if (current.length > 0) docs.push(join(current));
  return docs;
}

export async function extractTopics(
  transcript: string,
  apiKey: string,
): Promise<string[]> {
  if (!transcript.trim()) return [];
  // Cap input to keep token cost predictable.
  const trimmed = transcript.length > 30000 ? transcript.slice(0, 30000) : transcript;
  const prompt =
    `You are an expert JustCall conversation analyzer. Extract 0-10 short topics from this conversation transcript for use as vector DB metadata.

Topics should reflect: customer sentiment, JustCall PODs (Platform, Sales Dialer, Dialer, Mobile/Desktop Apps, Chrome Extension, Phone Numbers, SMS, Whatsapp, Calling, Quality, Bugs, AI, Integrations, Billing, Pricing, Trial, Voice, Analytics, etc.), pain points, issues, and feature requests.

- Skip greetings and small talk
- Don't include "AI Voice Agent" topics for SDR/sales bot interactions
- If no meaningful topics, return empty array
- Topics must come from customer/caller discussion content

Return ONLY a JSON object: { "Topics": ["topic 1", "topic 2"] }

Transcript:
${trimmed}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: TOPIC_MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI topics failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "{}";
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed.Topics) ? parsed.Topics : [];
  } catch {
    return [];
  }
}

export function getJustcallToken(team: "sales" | "success" | "support"): string {
  const key = team === "sales"
    ? "JUSTCALL_TOKEN_SALES"
    : team === "success"
    ? "JUSTCALL_TOKEN_SUCCESS"
    : "JUSTCALL_TOKEN_SUPPORT";
  const token = Deno.env.get(key);
  if (!token) throw new Error(`${key} is not configured`);
  return token;
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};
