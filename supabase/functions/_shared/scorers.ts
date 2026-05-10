// Async scorers attached to the Langfuse trace via trace.score(). Run inside
// EdgeRuntime.waitUntil after the synthesizer finishes so they don't add
// user-perceived latency.
//
// Five scorers fire on every chat request:
//   - faithfulness          (LLM judge)
//   - citation_accuracy     (programmatic)
//   - answer_relevance      (LLM judge)
//   - context_relevance     (LLM judge)
//   - format_compliance     (programmatic)
//
// A sixth scorer (routing_precision) fires only from the eval runner, since
// it requires expected_namespaces from a dataset item.

import type { RetrievedMatch, Session } from "./agents/types.ts";

const JUDGE_MODEL = "gpt-4.1-mini";

// === Shared LLM judge helper ===

async function judgeJson<T>(prompt: string, openAiKey: string): Promise<T | null> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiKey}`,
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  try {
    return JSON.parse(data.choices?.[0]?.message?.content || "{}") as T;
  } catch {
    return null;
  }
}

function clamp01(n: unknown): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

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

export type Score = {
  name: string;
  value: number;
  comment: string;
  metadata?: Record<string, unknown>;
};

// === 1. Faithfulness (LLM judge) ===

export async function faithfulnessScore(opts: {
  query: string;
  matches: RetrievedMatch[];
  answer: string;
  openAiKey: string;
}): Promise<Score> {
  if (!opts.answer.trim() || !opts.matches.length) {
    return {
      name: "faithfulness",
      value: 0,
      comment: "empty answer or empty context",
    };
  }
  const prompt =
    `You are evaluating an AI assistant's answer for faithfulness to retrieved source documents.

Score 0.0–1.0:
- 1.0 = every claim is supported by the context
- 0.7 = mostly grounded, minor unsupported elaboration
- 0.4 = mixed
- 0.0 = fabricates information

User question:
${opts.query}

Retrieved context:
${formatContext(opts.matches)}

Assistant answer:
${opts.answer}

List specific claims NOT supported by the context. Stylistic synthesis is fine — only flag factual claims.

Return JSON: { "score": <0..1>, "reasoning": "<one sentence>" }`;

  const result = await judgeJson<{ score: number; reasoning: string }>(
    prompt,
    opts.openAiKey,
  );
  return {
    name: "faithfulness",
    value: clamp01(result?.score),
    comment: result?.reasoning ?? "judge returned no result",
  };
}

// === 2. Citation accuracy (programmatic) ===

export function citationAccuracyScore(opts: {
  answer: string;
  matches: RetrievedMatch[];
}): Score {
  const inline = [...opts.answer.matchAll(/\[source:(\d+)\]/gi)]
    .map((m) => parseInt(m[1], 10));
  if (inline.length === 0) {
    return {
      name: "citation_accuracy",
      value: 0,
      comment: "no [source:N] citations in answer",
    };
  }
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

  const unique = [...new Set(inline)];
  let valid = 0;
  const failures: string[] = [];
  for (const n of unique) {
    const id = sourceMap.get(n);
    if (!id) {
      failures.push(`[source:${n}] missing in Sources block`);
      continue;
    }
    if (!validIds.has(id)) {
      failures.push(`[source:${n}] = ${id} not in retrieval`);
      continue;
    }
    valid++;
  }
  return {
    name: "citation_accuracy",
    value: unique.length === 0 ? 0 : valid / unique.length,
    comment: failures.length === 0
      ? `all ${valid} citations valid`
      : `${valid}/${unique.length} valid: ${failures.slice(0, 2).join("; ")}`,
    metadata: { totalCitations: unique.length, validCount: valid },
  };
}

// === 3. Answer relevance (LLM judge) ===

export async function answerRelevanceScore(opts: {
  query: string;
  answer: string;
  openAiKey: string;
}): Promise<Score> {
  if (!opts.answer.trim()) {
    return { name: "answer_relevance", value: 0, comment: "empty answer" };
  }
  const prompt =
    `You are evaluating whether an AI assistant's answer addresses the user's question.

Score 0.0–1.0:
- 1.0 = directly answers the question with relevant information
- 0.7 = answers but misses some aspects
- 0.4 = partially addresses, drifts off-topic
- 0.0 = doesn't answer the question at all

User question:
${opts.query}

Assistant answer:
${opts.answer}

Return JSON: { "score": <0..1>, "reasoning": "<one sentence>" }`;

  const result = await judgeJson<{ score: number; reasoning: string }>(
    prompt,
    opts.openAiKey,
  );
  return {
    name: "answer_relevance",
    value: clamp01(result?.score),
    comment: result?.reasoning ?? "judge returned no result",
  };
}

// === 4. Context relevance (LLM judge) ===

export async function contextRelevanceScore(opts: {
  query: string;
  matches: RetrievedMatch[];
  openAiKey: string;
}): Promise<Score> {
  if (!opts.matches.length) {
    return {
      name: "context_relevance",
      value: 0,
      comment: "no context retrieved",
    };
  }
  const prompt =
    `You are evaluating whether retrieved transcript snippets are relevant to a user query for a voice-of-customer intelligence assistant.

Score 0.0–1.0 based on the proportion of snippets that are on-topic:
- 1.0 = all snippets directly relevant
- 0.7 = most snippets relevant, some weakly so
- 0.4 = mixed, several off-topic
- 0.0 = retrieval missed the query entirely

User question:
${opts.query}

Retrieved snippets:
${formatContext(opts.matches)}

Return JSON: { "score": <0..1>, "reasoning": "<one sentence>", "relevant_count": <int>, "total": ${opts.matches.length} }`;

  const result = await judgeJson<{
    score: number;
    reasoning: string;
    relevant_count?: number;
    total?: number;
  }>(prompt, opts.openAiKey);
  return {
    name: "context_relevance",
    value: clamp01(result?.score),
    comment: result?.reasoning ?? "judge returned no result",
    metadata: result?.relevant_count !== undefined
      ? { relevant: result.relevant_count, total: result.total }
      : undefined,
  };
}

// === 5. Format compliance (programmatic) ===

export function formatComplianceScore(opts: { answer: string }): Score {
  const a = opts.answer || "";
  const checks = {
    has_sources_block: /\nSources:\s*\n/.test(a),
    has_inline_citation: /\[source:\d+\]/i.test(a),
    citations_in_sources: false,
    reasonable_length: a.length >= 200 && a.length <= 12000,
    has_structure: /\n##\s|\n\d+\.\s|\n[-*]\s/.test(a),
  };
  // Each inline citation should appear in the Sources block
  const sourcesIdx = a.lastIndexOf("Sources:");
  if (sourcesIdx >= 0) {
    const inline = [...a.matchAll(/\[source:(\d+)\]/gi)].map((m) => m[1]);
    const sourcesBlock = a.slice(sourcesIdx);
    checks.citations_in_sources = inline.every((n) =>
      new RegExp(`\\[${n}\\]\\s+CA`).test(sourcesBlock)
    );
  }
  const passed = Object.values(checks).filter(Boolean).length;
  const total = Object.keys(checks).length;
  const failures = Object.entries(checks)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  return {
    name: "format_compliance",
    value: passed / total,
    comment: failures.length === 0
      ? "all format checks passed"
      : `failed: ${failures.join(", ")}`,
    metadata: checks,
  };
}

// === 6. Routing precision (programmatic, eval-only) ===

export function routingPrecisionScore(opts: {
  chosenTools: string[];
  expectedNamespaces: string[];
}): Score {
  const expected = new Set(opts.expectedNamespaces);
  const chosen = new Set(opts.chosenTools);
  if (expected.size === 0) {
    return {
      name: "routing_precision",
      value: 1,
      comment: "no expected namespaces (gap-acknowledgment case)",
    };
  }
  const intersection = [...expected].filter((x) => chosen.has(x)).length;
  const precision = chosen.size === 0 ? 0 : intersection / chosen.size;
  const recall = expected.size === 0 ? 1 : intersection / expected.size;
  const f1 = (precision + recall) === 0
    ? 0
    : (2 * precision * recall) / (precision + recall);
  return {
    name: "routing_precision",
    value: f1,
    comment: `f1=${f1.toFixed(2)} (precision=${precision.toFixed(2)}, recall=${
      recall.toFixed(2)
    }) chosen=[${[...chosen].join(",")}] expected=[${[...expected].join(",")}]`,
    metadata: { precision, recall, f1 },
  };
}

// === Top-level runner ===

// Runs all five online scorers in parallel and returns Score objects (callers
// post them to Langfuse via trace.score()). Failures of individual scorers do
// not affect others.
export async function runAllOnlineScorers(opts: {
  query: string;
  answer: string;
  session: Session;
  openAiKey: string;
}): Promise<Score[]> {
  const matches = opts.session.reranked ?? [];
  const settled = await Promise.allSettled([
    faithfulnessScore({
      query: opts.query,
      matches,
      answer: opts.answer,
      openAiKey: opts.openAiKey,
    }),
    Promise.resolve(citationAccuracyScore({ answer: opts.answer, matches })),
    answerRelevanceScore({
      query: opts.query,
      answer: opts.answer,
      openAiKey: opts.openAiKey,
    }),
    contextRelevanceScore({
      query: opts.query,
      matches,
      openAiKey: opts.openAiKey,
    }),
    Promise.resolve(formatComplianceScore({ answer: opts.answer })),
  ]);
  const scores: Score[] = [];
  for (const s of settled) {
    if (s.status === "fulfilled") scores.push(s.value);
    else console.error("scorer failed:", s.reason);
  }
  return scores;
}
