// Proves the database checks still bite (M0 plan §5, PR 0.2), the way rails-selftest.mjs does
// for the lint and the matrix. Needs a running local stack (`pnpm db:start`), so it runs in the
// CI `db` job rather than in `pnpm check`.
//
// It adds one throwaway table to the local database, outside any migration, and asserts that
//   1. the generated types no longer match the committed packages/db/src/types.gen.ts, and
//   2. the pgTAP smoke test fails ("public has no tables yet").
// A drift check that can't see a new table, or a test run that can't fail, passes for ever.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import * as prettier from "prettier";

const root = path.resolve(import.meta.dirname, "..");
const typesFile = path.join(root, "packages/db/src/types.gen.ts");
const table = "public.__selftest__";
const failures = [];

const supabase = (...args) =>
  spawnSync("pnpm", ["exec", "supabase", ...args, "--workdir", "packages/db"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

const query = (sql) => {
  const result = supabase("db", "query", "--local", sql);
  if (result.status !== 0) throw new Error(`query failed: ${sql}\n${result.stderr}`);
};

const generatedTypes = async () => {
  const result = supabase("gen", "types", "typescript", "--local");
  if (result.status !== 0) throw new Error(`gen types failed\n${result.stderr}`);
  const options = await prettier.resolveConfig(typesFile);
  return prettier.format(result.stdout, { ...options, filepath: typesFile });
};

const committed = fs.readFileSync(typesFile, "utf8");

// Positive control: before the fixture, the regenerated types match what's committed.
if ((await generatedTypes()) !== committed) {
  console.error("db rails: types.gen.ts is already stale; run `pnpm db:types` first.");
  process.exit(1);
}

query(`create table ${table} (id int primary key)`);
try {
  if ((await generatedTypes()) === committed) {
    failures.push(`type drift: a new table (${table}) did not change the generated types`);
  }
  const test = supabase("test", "db");
  if (test.status === 0) {
    failures.push(`pgTAP: the smoke test passed with ${table} present`);
  }
} finally {
  query(`drop table if exists ${table}`);
}

if (failures.length > 0) {
  console.error("DB rails self-test FAILED. These violations were not caught:\n");
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log("DB rails self-test passed: type drift and pgTAP both caught an unmigrated table.");
