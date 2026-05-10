// Seed the Langfuse Dataset with golden test cases from cases.json.
// Idempotent at the dataset level (Langfuse upserts on dataset name).
// Items are appended each run — if you re-run after editing cases.json, you'll
// have duplicates with new IDs but only the most recent run's items will be
// linked when you next call run.mjs.

import { Langfuse } from "langfuse";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireEnv } from "./_env.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(fs.readFileSync(path.join(here, "cases.json"), "utf8"));

const DATASET_NAME = "echo-golden";

const langfuse = new Langfuse({
  publicKey: requireEnv("LANGFUSE_PUBLIC_KEY"),
  secretKey: requireEnv("LANGFUSE_SECRET_KEY"),
  baseUrl: process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com",
});

console.log(`Seeding into dataset "${DATASET_NAME}"…`);

await langfuse.createDataset({
  name: DATASET_NAME,
  description: "Golden test cases for the Echo agentic RAG pipeline",
});

// Idempotent: fetch existing items by name, skip ones already seeded.
// API caps limit at 100, so paginate.
const baseUrl = process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com";
const auth = Buffer.from(
  `${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`,
).toString("base64");
const existingNames = new Set();
for (let page = 1; page <= 20; page++) {
  const res = await fetch(
    `${baseUrl}/api/public/dataset-items?datasetName=${DATASET_NAME}&limit=100&page=${page}`,
    { headers: { Authorization: `Basic ${auth}` } },
  );
  if (!res.ok) break;
  const json = await res.json();
  const items = json.data ?? [];
  if (items.length === 0) break;
  for (const it of items) {
    const n = it.metadata?.name;
    if (n) existingNames.add(n);
  }
  if (items.length < 100) break;
}
console.log(`Found ${existingNames.size} existing items in dataset.\n`);

let added = 0;
let skipped = 0;
let fail = 0;
for (const c of cases) {
  if (existingNames.has(c.name)) {
    console.log(`  - ${c.name} (skipped — already seeded)`);
    skipped++;
    continue;
  }
  try {
    await langfuse.createDatasetItem({
      datasetName: DATASET_NAME,
      input: c.input,
      expectedOutput: c.expected ?? undefined,
      metadata: { ...c.metadata, name: c.name },
    });
    console.log(`  ✓ ${c.name}`);
    added++;
  } catch (err) {
    console.log(`  ✗ ${c.name}: ${err?.message ?? err}`);
    fail++;
  }
}

await langfuse.flushAsync();
console.log(`\nDone — ${added} added, ${skipped} already present, ${fail} failed.`);
console.log(
  `View: ${
    process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com"
  }/datasets`,
);
