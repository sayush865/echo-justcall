// OpenAI helpers shared across agents. Each call optionally attaches a
// Langfuse generation under `parentSpan` so the trace tree captures inputs,
// outputs, latency, and token usage.

const EMBED_MODEL = "text-embedding-3-small";
const EMBED_DIMS = 512;

// Loose typing for Langfuse trace/span objects so this module doesn't have
// to import the SDK directly. Both LangfuseTraceClient and LangfuseSpanClient
// expose .span() and .generation().
// deno-lint-ignore no-explicit-any
type ParentSpan = any | null | undefined;

export async function embedSingle(
  text: string,
  apiKey: string,
  parentSpan?: ParentSpan,
): Promise<number[]> {
  const out = await embedBatch([text], apiKey, parentSpan);
  return out[0];
}

export async function embedBatch(
  texts: string[],
  apiKey: string,
  parentSpan?: ParentSpan,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const generation = parentSpan?.generation?.({
    name: "openai-embed",
    model: EMBED_MODEL,
    input: texts,
    metadata: { dimensions: EMBED_DIMS, batchCount: texts.length },
  });

  const out: number[][] = [];
  let totalUsage = 0;
  try {
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
      totalUsage += data.usage?.total_tokens ?? 0;
    }
    generation?.end?.({
      output: { vectors: out.length, dimensions: out[0]?.length },
      usage: { input: totalUsage, total: totalUsage },
    });
    return out;
  } catch (err) {
    generation?.end?.({
      level: "ERROR",
      statusMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function chatJson<T = unknown>(opts: {
  apiKey: string;
  model: string;
  messages: { role: string; content: string }[];
  parentSpan?: ParentSpan;
  spanName?: string;
}): Promise<T> {
  const generation = opts.parentSpan?.generation?.({
    name: opts.spanName ?? "openai-chat-json",
    model: opts.model,
    input: opts.messages,
    modelParameters: { response_format: "json_object" },
  });

  try {
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
    const parsed = JSON.parse(content) as T;
    generation?.end?.({
      output: parsed,
      usage: {
        input: data.usage?.prompt_tokens,
        output: data.usage?.completion_tokens,
        total: data.usage?.total_tokens,
      },
    });
    return parsed;
  } catch (err) {
    generation?.end?.({
      level: "ERROR",
      statusMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function chatStream(opts: {
  apiKey: string;
  model: string;
  messages: { role: string; content: string }[];
  onContent: (delta: string) => void | Promise<void>;
  parentSpan?: ParentSpan;
  spanName?: string;
}): Promise<string> {
  const generation = opts.parentSpan?.generation?.({
    name: opts.spanName ?? "openai-chat-stream",
    model: opts.model,
    input: opts.messages,
    modelParameters: { stream: true },
  });

  try {
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
        stream_options: { include_usage: true },
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI chat (stream) failed: ${res.status} ${await res.text()}`);
    }
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
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
          if (chunk.usage) usage = chunk.usage;
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
    generation?.end?.({
      output: full,
      usage: usage
        ? {
          input: usage.prompt_tokens,
          output: usage.completion_tokens,
          total: usage.total_tokens,
        }
        : undefined,
    });
    return full;
  } catch (err) {
    generation?.end?.({
      level: "ERROR",
      statusMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
