// Tiny .env.local loader so eval scripts can read secrets without a dotenv dep.
// Reads .env.local from repo root if present; preserves any env vars already set
// (so CLI overrides win).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

// Loads .env first (committed defaults like VITE_SUPABASE_URL), then .env.local
// (gitignored, holds secrets). Both are optional. Existing env vars (CLI / shell
// overrides) always win — we never overwrite.
function loadEnvFile(name) {
  const p = path.resolve(repoRoot, name);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (m[1] in process.env) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

export function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(
      `Missing env: ${name}. Set it in .env.local at the repo root or export it before running.`,
    );
    process.exit(1);
  }
  return v;
}
