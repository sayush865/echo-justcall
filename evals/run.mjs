// Run the Echo chat function against every item in the Langfuse dataset.
// Each run is grouped under a unique runName so you can compare two runs
// side-by-side in the Langfuse UI (Datasets → echo-golden → Runs).
//
// Flow per item:
//   1. Insert a transient conversation + user message into Supabase
//   2. Call /functions/v1/chat (which auto-creates a Langfuse trace tagged
//      with sessionId = conversationId, plus emits faithfulness +
//      citation_accuracy scores in the background)
//   3. Drain the NDJSON stream
//   4. Look up the trace by sessionId via Langfuse public API
//   5. Link the trace to the dataset item under runName
//
// At the end, prints summary stats and a link to view the run in Langfuse.

import { Langfuse } from "langfuse";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { requireEnv } from "./_env.mjs";

const DATASET = "echo-golden";
const RUN_NAME = process.env.RUN_NAME ?? `run-${
  new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")
}`;

const SUPABASE_URL = requireEnv("VITE_SUPABASE_URL");
const SUPABASE_ANON = requireEnv("VITE_SUPABASE_PUBLISHABLE_KEY");
const SUPABASE_SERVICE = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const lfPub = requireEnv("LANGFUSE_PUBLIC_KEY");
const lfSec = requireEnv("LANGFUSE_SECRET_KEY");
const lfBase = process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);
const langfuse = new Langfuse({
  publicKey: lfPub,
  secretKey: lfSec,
  baseUrl: lfBase,
});

console.log(`Run name: ${RUN_NAME}\nFetching dataset "${DATASET}"…`);
const dataset = await langfuse.getDataset(DATASET);
const limit = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : undefined;
const items = limit ? dataset.items.slice(0, limit) : dataset.items;
console.log(
  `Running ${items.length} items${limit ? ` (LIMIT=${limit} of ${dataset.items.length})` : ""}\n`,
);

const lfAuth = Buffer.from(`${lfPub}:${lfSec}`).toString("base64");

// Polls until the trace AND its metadata.routes are ingested. The chat
// function calls trace.update({metadata: {routes: [...]}}) at the end, which
// arrives in Langfuse after the initial trace event — so a naive lookup gets
// the trace with empty metadata. Wait for routes specifically.
async function findTraceBySession(sessionId, attempts = 12, delayMs = 1500) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(
      `${lfBase}/api/public/traces?sessionId=${sessionId}&limit=1`,
      { headers: { Authorization: `Basic ${lfAuth}` } },
    );
    if (res.ok) {
      const json = await res.json();
      const trace = json.data?.[0];
      if (trace) {
        last = trace;
        if (Array.isArray(trace.metadata?.routes)) return trace;
      }
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return last; // return whatever we got, even if metadata is incomplete
}

// Direct REST call. The SDK's item.link() requires a LangfuseObjectClient
// (not just an ID), and constructing a fake client risks overwriting the
// real trace's metadata. The public REST API takes traceId directly.
async function createDatasetRunItem({
  runName,
  datasetItemId,
  traceId,
  runDescription,
  metadata,
}) {
  const res = await fetch(`${lfBase}/api/public/dataset-run-items`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${lfAuth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      runName,
      datasetItemId,
      traceId,
      runDescription,
      metadata,
    }),
  });
  if (!res.ok) {
    throw new Error(`dataset-run-items ${res.status}: ${await res.text()}`);
  }
  return await res.json();
}

// Eval-only programmatic scorer: F1 between router's chosen tools and the
// dataset item's expected_namespaces. Posted directly via the public scores
// API since we can't easily call trace.score() from outside the chat function.
async function postRoutingPrecision({ traceId, chosenTools, expectedNamespaces }) {
  const expected = new Set(expectedNamespaces ?? []);
  const chosen = new Set(chosenTools ?? []);
  let value;
  let comment;
  if (expected.size === 0) {
    value = 1; // gap-acknowledgment cases — anything goes
    comment = "no expected namespaces (edge case)";
  } else {
    const intersection = [...expected].filter((x) => chosen.has(x)).length;
    const precision = chosen.size === 0 ? 0 : intersection / chosen.size;
    const recall = intersection / expected.size;
    value = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    comment = `f1=${value.toFixed(2)} (p=${precision.toFixed(2)} r=${recall.toFixed(2)})`;
  }
  const res = await fetch(`${lfBase}/api/public/scores`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${lfAuth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      traceId,
      name: "routing_precision",
      value,
      comment,
      dataType: "NUMERIC",
    }),
  });
  if (!res.ok) {
    console.warn(`routing_precision post failed: ${res.status} ${await res.text()}`);
  }
  return value;
}

async function callChat(query, conversationId) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_ANON}`,
    },
    body: JSON.stringify({ message: query, conversationId }),
  });
  if (!res.ok) {
    throw new Error(`chat ${res.status}: ${await res.text()}`);
  }
  let full = "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        if (o.type === "item" && typeof o.content === "string") full += o.content;
      } catch {
        // ignore
      }
    }
  }
  return full;
}

const results = [];
for (const item of items) {
  const name = item.metadata?.name ?? item.id.slice(0, 8);
  const query = item.input?.query;
  if (!query) {
    console.log(`  - ${name}: skipped (no query in input)`);
    continue;
  }

  const conversationId = randomUUID();
  const start = Date.now();
  try {
    await supabase.from("conversations").insert({
      id: conversationId,
      title: `eval/${RUN_NAME}/${name}`,
    });
    await supabase.from("messages").insert({
      conversation_id: conversationId,
      role: "user",
      content: query,
    });

    const answer = await callChat(query, conversationId);
    const latency = Date.now() - start;

    const trace = await findTraceBySession(conversationId);
    if (!trace) {
      console.log(
        `  ! ${name}: chat OK (${latency}ms, ${answer.length} chars) but trace not found in Langfuse`,
      );
      results.push({ name, latency, traceId: null });
      continue;
    }

    await createDatasetRunItem({
      runName: RUN_NAME,
      datasetItemId: item.id,
      traceId: trace.id,
      runDescription: `Echo eval run ${RUN_NAME}`,
      metadata: { latency_ms: latency, answer_length: answer.length },
    });

    // Compute routing_precision against the item's expected_namespaces.
    const chosenTools = trace.metadata?.routes ?? [];
    const expectedNamespaces = item.metadata?.expected_namespaces ?? [];
    const routingF1 = await postRoutingPrecision({
      traceId: trace.id,
      chosenTools,
      expectedNamespaces,
    });

    console.log(
      `  ✓ ${name.padEnd(28)} ${String(latency).padStart(6)}ms  trace=${trace.id.slice(0, 8)}  route_f1=${routingF1.toFixed(2)}`,
    );
    results.push({ name, latency, traceId: trace.id, routingF1 });
  } catch (err) {
    console.log(`  ✗ ${name}: ${err?.message ?? err}`);
    results.push({ name, error: String(err?.message ?? err) });
  }
}

await langfuse.flushAsync();

const ok = results.filter((r) => r.traceId);
const failed = results.filter((r) => r.error);
const avgLatency = ok.length
  ? Math.round(ok.reduce((s, r) => s + r.latency, 0) / ok.length)
  : 0;

console.log(`\nRun "${RUN_NAME}" complete:`);
console.log(`  ${ok.length}/${results.length} ok, ${failed.length} failed`);
console.log(`  avg chat latency: ${avgLatency}ms`);
console.log(
  `\nFaithfulness + citation_accuracy scores fire async on the chat function and`,
);
console.log(
  `attach to traces within ~30s. Refresh the Langfuse Datasets view to see them.`,
);
console.log(
  `\nView: ${lfBase}/project/<projectId>/datasets/${encodeURIComponent(DATASET)}/runs/${
    encodeURIComponent(RUN_NAME)
  }`,
);
