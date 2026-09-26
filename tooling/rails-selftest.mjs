// Proves the structural rules still bite (M0 plan §5, PR 0.1). A misconfigured lint rule or
// dependency rule passes silently forever, so this feeds each one a known violation and fails
// if it is *not* reported. The normal `pnpm lint` / `pnpm deps` runs are the positive control.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ESLint } from "eslint";
import picomatch from "picomatch";

const root = path.resolve(import.meta.dirname, "..");
const failures = [];

// --- 1. The packages/core purity lint -----------------------------------------------------

const eslint = new ESLint({ cwd: root });
const coreFile = path.join(root, "packages/core/src/__selftest__.ts");

const mustFail = {
  "Date.now()": ["export const t = Date.now();", "no-restricted-properties"],
  "new Date()": ["export const t = new Date();", "no-restricted-syntax"],
  "Date()": ["export const t = Date();", "no-restricted-syntax"],
  "Math.random()": ["export const r = Math.random();", "no-restricted-properties"],
  "Temporal.Now": [
    "declare const Temporal: any;\nexport const t = Temporal.Now.instant();",
    "no-restricted-properties",
  ],
  "fetch()": ["export const p = fetch('https://example.com');", "no-restricted-globals"],
  "globalThis.fetch": ["export const f = globalThis.fetch;", "no-restricted-globals"],
  "process.env": ["export const e = process.env['X'];", "no-restricted-globals"],
  "crypto.randomUUID()": ["export const id = crypto.randomUUID();", "no-restricted-globals"],
  "console.log": ["console.log('x');", "no-restricted-globals"],
  setTimeout: ["setTimeout(() => {}, 1);", "no-restricted-globals"],
  "import node:fs": ["import fs from 'node:fs';\nexport { fs };", "no-restricted-imports"],
  "import fs": ["import fs from 'fs';\nexport { fs };", "no-restricted-imports"],
  "import @faff/db": ["export { packageName } from '@faff/db';", "no-restricted-imports"],
  "import @supabase/*": [
    "import { createClient } from '@supabase/supabase-js';\nexport { createClient };",
    "no-restricted-imports",
  ],
  "dynamic import": ["export const m = import('zod');", "no-restricted-syntax"],
  "temporal-polyfill/global outside time.ts": [
    "import 'temporal-polyfill/global';\nexport const x = 1;",
    "no-restricted-imports",
  ],
  "a global Temporal outside time.ts": [
    "export const t = (s: string) => Temporal.Instant.from(s);",
    "no-restricted-globals",
  ],
  "temporal-polyfill outside time.ts": [
    "import { Temporal } from 'temporal-polyfill';\nexport { Temporal };",
    "no-restricted-imports",
  ],
};

const mustPass = {
  "new Date(ms)": "export const t = (ms: number) => new Date(ms);",
  "a pure function": "export const add = (a: number, b: number) => a + b;",
};

for (const [label, [code, rule]] of Object.entries(mustFail)) {
  const [result] = await eslint.lintText(code, { filePath: coreFile });
  if (!result.messages.some((m) => m.ruleId === rule)) {
    failures.push(`core purity: ${label} was not reported by ${rule}`);
  }
}
for (const [label, code] of Object.entries(mustPass)) {
  const [result] = await eslint.lintText(code, { filePath: coreFile });
  const purity = result.messages.filter((m) => m.ruleId?.startsWith("no-restricted-"));
  if (purity.length > 0) {
    failures.push(`core purity: ${label} was wrongly reported (${purity[0].message})`);
  }
}

// The purity rules cover every TypeScript extension, not just .ts.
for (const ext of ["tsx", "mts", "cts"]) {
  const [result] = await eslint.lintText("export const t = Date.now();", {
    filePath: path.join(root, `packages/core/src/__selftest__.${ext}`),
  });
  if (!result.messages.some((m) => m.ruleId === "no-restricted-properties")) {
    failures.push(`core purity: Date.now() in a .${ext} file was not reported`);
  }
}

// Tests in core are exempt: they may use the clock and vitest.
{
  const [result] = await eslint.lintText("export const t = Date.now();", {
    filePath: path.join(root, "packages/core/src/__selftest__.test.ts"),
  });
  if (result.messages.some((m) => m.ruleId?.startsWith("no-restricted-"))) {
    failures.push("core purity: a test file was wrongly held to the purity rules");
  }
}

// time.ts is the one module that may import Temporal, and it is still held to the rest.
{
  const timeFile = path.join(root, "packages/core/src/time.ts");
  const [allowed] = await eslint.lintText(
    "import { Temporal } from 'temporal-polyfill';\nexport { Temporal };",
    { filePath: timeFile },
  );
  if (allowed.messages.some((m) => m.ruleId === "no-restricted-imports")) {
    failures.push("core purity: time.ts was wrongly stopped from importing temporal-polyfill");
  }
  const [clock] = await eslint.lintText("export const t = Date.now();", { filePath: timeFile });
  if (!clock.messages.some((m) => m.ruleId === "no-restricted-properties")) {
    failures.push("core purity: Date.now() in time.ts was not reported");
  }
}

// --- 2. Next.js lint rules: apps/web only ------------------------------------------------

{
  const code = 'export const I = () => <img src="/a.png" alt="" />;';
  const lint = async (file) => {
    const [result] = await eslint.lintText(code, { filePath: path.join(root, file) });
    return result.messages.some((m) => m.ruleId === "@next/next/no-img-element");
  };
  if (!(await lint("apps/web/src/app/__selftest__.tsx"))) {
    failures.push("next lint: <img> in apps/web was not reported by @next/next/no-img-element");
  }
  if (await lint("packages/agents/src/__selftest__.tsx")) {
    failures.push("next lint: a Next rule was applied outside apps/web");
  }
}

// --- 3. The dependency matrix -------------------------------------------------------------

const fixtures = {
  // A relative import across packages dodges pnpm; the matrix rule must still catch it.
  "packages/agents/src/__selftest__/relative-db.ts": [
    "export { packageName } from '../../../db/src/index';\n",
    "matrix:packages/agents",
  ],
  // agents doesn't declare @faff/db, so pnpm won't resolve it.
  "packages/agents/src/__selftest__/workspace-db.ts": [
    "export { packageName } from '@faff/db';\n",
    "not-to-unresolvable",
  ],
  // apps/web may import core, db and agents only: never the tool server (spec 01, D3).
  "apps/web/src/__selftest__/tools.ts": [
    "export { packageName } from '../../../../packages/tools/src/index';\n",
    "matrix:apps/web",
  ],
  // The worker may import every package, but never the web app.
  "apps/worker/src/__selftest__/web.ts": [
    "export { packageName } from '../../../web/src/index';\n",
    "matrix:apps/worker",
  ],
  "packages/core/src/__selftest__/sibling.ts": [
    "export { packageName } from '../../../sim/src/index';\n",
    "matrix:packages/core",
  ],
  // vitest is installed but not on core's runtime allow-list.
  "packages/core/src/__selftest__/third-party.ts": [
    "export { describe } from 'vitest';\n",
    "core-runtime-allowlist",
  ],
  "packages/core/src/__selftest__/builtin.ts": [
    "export { readFileSync } from 'node:fs';\n",
    "core-runtime-allowlist",
  ],
};

const written = new Set();
try {
  for (const [file, [code]] of Object.entries(fixtures)) {
    const abs = path.join(root, file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    written.add(path.dirname(abs));
    fs.writeFileSync(abs, code);
  }

  let output;
  try {
    output = execFileSync(
      "pnpm",
      ["exec", "depcruise", "--output-type", "json", ...Object.keys(fixtures)],
      { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (error) {
    // depcruise exits non-zero when it finds violations, which is what we want here.
    output = error.stdout;
  }
  const { summary } = JSON.parse(output);

  for (const [file, [, rule]] of Object.entries(fixtures)) {
    const hit = summary.violations.some((v) => v.from === file && v.rule.name === rule);
    if (!hit) failures.push(`dependency matrix: ${file} was not reported by ${rule}`);
  }
} finally {
  for (const dir of written) fs.rmSync(dir, { recursive: true, force: true });
}

// --- 4. CODEOWNERS: claims.ts and the en-GB catalogue need a review (I-1, I-12) ------------

// GitHub applies the *last* matching line, and a line with no owners removes the requirement.
// Patterns follow gitignore rules: a leading or inner "/" anchors to the repo root, otherwise the
// pattern matches at any depth; a trailing "/" means a directory; a directory match covers
// everything under it.
function ownersFor(codeowners, file) {
  const rules = codeowners
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(/\s+/));
  const matches = (pattern) => {
    let glob = pattern.replace(/\/$/, "");
    const anchored = glob.startsWith("/") || glob.includes("/");
    glob = glob.replace(/^\//, "");
    if (!anchored) glob = `**/${glob}`;
    const opts = { dot: true };
    return picomatch.isMatch(file, glob, opts) || picomatch.isMatch(file, `${glob}/**`, opts);
  };
  const last = rules.findLast(([pattern]) => matches(pattern));
  return last ? last.slice(1) : [];
}

const guarded = [
  "apps/web/content/claims.ts",
  "packages/core/src/locale/en-GB.ts",
  "packages/core/src/render/brief-card.ts",
  "packages/core/src/render/acceptance-rule.ts",
  "packages/core/src/__fixtures__/en-GB/opener.json",
  "packages/core/src/__fixtures__/en-GB/signature.json",
  ".github/CODEOWNERS",
];
const codeowners = fs.readFileSync(path.join(root, ".github/CODEOWNERS"), "utf8");
for (const file of guarded) {
  if (!fs.existsSync(path.join(root, file))) failures.push(`codeowners: ${file} is missing`);
  if (ownersFor(codeowners, file).length === 0) {
    failures.push(`codeowners: ${file} has no owner`);
  }
}

// Each appended line takes the owner off claims.ts on GitHub, so the check above must see it.
const ownerRemovals = ["*.ts", "*", "/apps/web/", "apps/", "claims.ts", "**/content/*", "/apps/**"];
for (const line of ownerRemovals) {
  if (ownersFor(`${codeowners}\n${line}\n`, guarded[0]).length > 0) {
    failures.push(`codeowners: an ownerless "${line}" line was not seen to remove the owner`);
  }
}
// ...and a later line that gives the file an owner again, or doesn't match it, must not.
for (const line of ["*.md", "/docs/", "claims.tsx"]) {
  if (ownersFor(`${codeowners}\n${line}\n`, guarded[0]).length === 0) {
    failures.push(`codeowners: an unrelated "${line}" line was wrongly seen to remove the owner`);
  }
}

// --- 5. The Brief JSON Schema drift check ------------------------------------------------

// `pnpm schema:check` compares docs/spec/schemas/brief.v1.json with toJsonSchema(). Run it
// against copies: the committed file must pass, and a drifted or missing one must fail.
const schemaCases = [];
{
  const committed = fs.readFileSync(path.join(root, "docs/spec/schemas/brief.v1.json"), "utf8");
  const drifted = committed.replace(
    '"maxDialAttempts": { "default": 3,',
    '"maxDialAttempts": { "default": 99,',
  );
  if (drifted === committed) {
    failures.push("schema drift: the maxDialAttempts default the drift case edits wasn't found");
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-rails-schema-"));
  const cases = {
    "the committed schema": [committed, 0],
    // Formatted as the committed file is, so the default is the only difference.
    "a drifted default": [drifted, 1],
    "a whitespace-only change": [committed.replace(/\n$/, ""), 1],
    "a missing file": [undefined, 1],
  };
  try {
    for (const [label, [content, expected]] of Object.entries(cases)) {
      const file = path.join(tmp, `${schemaCases.length}.json`);
      if (content !== undefined) fs.writeFileSync(file, content);
      let status = 0;
      try {
        execFileSync(
          "pnpm",
          ["exec", "tsx", "tooling/brief-schema.ts", "--check", "--file", file],
          {
            cwd: root,
            stdio: "pipe",
          },
        );
      } catch (error) {
        status = error.status;
      }
      schemaCases.push(label);
      if (status !== expected) {
        failures.push(
          `schema drift: ${label} exited ${status}, expected ${expected === 0 ? "a pass" : "a failure"}`,
        );
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// --- Result -------------------------------------------------------------------------------

if (failures.length > 0) {
  console.error("Rails self-test FAILED. These violations were not caught:\n");
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
const count = Object.keys(mustFail).length + Object.keys(mustPass).length + 6;
console.log(
  `Rails self-test passed: ${count} purity-lint cases, 2 Next lint cases, ` +
    `${Object.keys(fixtures).length} dependency cases, ${guarded.length + ownerRemovals.length + 3} CODEOWNERS cases, ` +
    `${schemaCases.length} schema-drift cases.`,
);
