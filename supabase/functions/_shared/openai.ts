// OpenAI helpers shared across agents.

const EMBED_MODEL = "text-embedding-3-small";
const EMBED_DIMS = 512;

export async function embedSingle(text: string, apiKey: string): Promise<number[]> {
  const out = await embedBatch([text], apiKey);
  return out[0];
}

export async function embedBatch(texts: string[], apiKey: string): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out: number[][] = [];
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

export async function chatJson<T = unknown>(opts: {
  apiKey: string;
  model: string;
  messages: { role: string; content: string }[];
}): Promise<T> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI chat (json) failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "{}";
  return JSON.parse(content) as T;
}

export async function chatStream(opts: {
  apiKey: string;
  model: string;
  messages: { role: string; content: string }[];
  onContent: (delta: string) => void | Promise<void>;
}): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      stream: true,
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI chat (stream) failed: ${res.status} ${await res.text()}`);
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const chunk = JSON.parse(payload);
        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) {
          full += delta;
          await opts.onContent(delta);
        }
      } catch {
        // skip malformed
      }
    }
  }
  return full;
}
