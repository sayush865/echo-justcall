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

console.log(`Seeding ${cases.length} cases into dataset "${DATASET_NAME}"…`);

await langfuse.createDataset({
  name: DATASET_NAME,
  description: "Golden test cases for the Echo agentic RAG pipeline",
});

let ok = 0;
let fail = 0;
for (const c of cases) {
  try {
    await langfuse.createDatasetItem({
      datasetName: DATASET_NAME,
      input: c.input,
      expectedOutput: c.expected ?? undefined,
      metadata: { ...c.metadata, name: c.name },
    });
    console.log(`  ✓ ${c.name}`);
    ok++;
  } catch (err) {
    console.log(`  ✗ ${c.name}: ${err?.message ?? err}`);
    fail++;
  }
}

await langfuse.flushAsync();
console.log(`\nDone — ${ok} seeded, ${fail} failed.`);
console.log(
  `View: ${
    process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com"
  }/datasets`,
);
