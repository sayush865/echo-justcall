// Async scorers that run after the synthesizer finishes and emit scores via
// Langfuse `trace.score()`. Runs inside EdgeRuntime.waitUntil so they don't
// add user-perceived latency.
//
// Scores show up in the Langfuse UI under Scores tab + as badges on each trace.

import type { RetrievedMatch } from "./agents/types.ts";

const JUDGE_MODEL = "gpt-4.1-mini";

const FAITHFULNESS_PROMPT =
  `You are evaluating an AI assistant's answer for faithfulness to retrieved source documents.

Score from 0.0 to 1.0:
- 1.0 = every claim in the answer is supported by the provided context
- 0.7 = mostly grounded, minor unsupported elaboration
- 0.4 = mixed — some grounded, some fabricated
- 0.0 = answer fabricates information not in the context

User question:
{{query}}

Retrieved context (transcript snippets that were given to the assistant):
{{context}}

Assistant answer:
{{answer}}

Think step by step. Identify any specific claims in the answer that are NOT supported by the context. Stylistic synthesis is fine — only flag factual claims that go beyond the context.

Return JSON: { "score": <0.0..1.0>, "reasoning": "<one sentence>" }`;

function formatContext(matches: RetrievedMatch[]): string {
  if (!matches.length) return "(no context retrieved)";
  return matches.map((m, i) => {
    const meta = m.metadata as Record<string, any>;
    const id = meta.callSID || meta.instanceId || m.id;
    const summary = typeof meta.summary === "string" ? meta.summary : "";
    const body = m.text || summary;
    return `[Snippet ${i + 1} | id=${id}]\n${body.slice(0, 1200)}`;
  }).join("\n\n");
}

export async function faithfulnessScore(opts: {
  query: string;
  matches: RetrievedMatch[];
  answer: string;
  openAiKey: string;
}): Promise<{ value: number; reasoning: string }> {
  if (!opts.answer.trim() || !opts.matches.length) {
    return { value: 0, reasoning: "empty answer or empty context" };
  }
  const prompt = FAITHFULNESS_PROMPT
    .replace("{{query}}", opts.query)
    .replace("{{context}}", formatContext(opts.matches))
    .replace("{{answer}}", opts.answer);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.openAiKey}`,
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    throw new Error(`faithfulness judge failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "{}";
  try {
    const parsed = JSON.parse(content);
    const score = typeof parsed.score === "number"
      ? Math.max(0, Math.min(1, parsed.score))
      : 0;
    return {
      value: score,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    };
  } catch {
    return { value: 0, reasoning: "judge returned unparseable JSON" };
  }
}

// Programmatic check: every [source:N] in the answer maps to a real CA-prefixed
// ID listed in the Sources block, and that ID exists in retrieval.
export function citationAccuracyScore(opts: {
  answer: string;
  matches: RetrievedMatch[];
}): { value: number; reasoning: string; details: Record<string, unknown> } {
  const inlineCitations = [...opts.answer.matchAll(/\[source:(\d+)\]/gi)]
    .map((m) => parseInt(m[1], 10));
  if (inlineCitations.length === 0) {
    return {
      value: 0,
      reasoning: "no [source:N] citations in answer",
      details: { inlineCount: 0 },
    };
  }

  // Parse the Sources: block
  const sourcesIdx = opts.answer.lastIndexOf("Sources:");
  const sourcesBlock = sourcesIdx >= 0 ? opts.answer.slice(sourcesIdx) : "";
  const sourceLines = [...sourcesBlock.matchAll(/\[(\d+)\]\s+(CA[A-Za-z0-9]+)/g)];
  const sourceMap = new Map<number, string>();
  for (const [, n, id] of sourceLines) sourceMap.set(parseInt(n, 10), id);

  const validIds = new Set<string>();
  for (const m of opts.matches) {
    const meta = m.metadata as Record<string, any>;
    const id = meta.callSID || meta.instanceId;
    if (typeof id === "string") validIds.add(id);
  }

  const uniqueCitations = [...new Set(inlineCitations)];
  let valid = 0;
  const failures: string[] = [];
  for (const n of uniqueCitations) {
    const id = sourceMap.get(n);
    if (!id) {
      failures.push(`[source:${n}] has no Sources block entry`);
      continue;
    }
    if (!validIds.has(id)) {
      failures.push(`[source:${n}] = ${id} is not in retrieval set`);
      continue;
    }
    valid++;
  }

  const score = uniqueCitations.length === 0
    ? 0
    : valid / uniqueCitations.length;
  return {
    value: score,
    reasoning: failures.length === 0
      ? `all ${valid} citations valid`
      : `${valid}/${uniqueCitations.length} valid: ${failures.slice(0, 3).join("; ")}`,
    details: {
      uniqueCitationCount: uniqueCitations.length,
      validCount: valid,
      failureCount: failures.length,
    },
  };
}
