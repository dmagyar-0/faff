// Writes or checks docs/spec/schemas/brief.v1.json, the JSON Schema export of faff.brief/v1
// (spec 02, M1 plan §3.1). The zod schema in packages/core is the source of truth; the committed
// file is what an external producer validates against, so CI fails when the two drift.
//
//   pnpm schema:write            regenerate the committed file
//   pnpm schema:check            exit 1 if the committed file differs from toJsonSchema()
//   ... --file <path>            use another file (the rails self-test points this at a copy)

import fs from "node:fs";
import path from "node:path";

import prettier from "prettier";

import { toJsonSchema } from "../packages/core/src/brief";

const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const mode = args.includes("--write") ? "write" : args.includes("--check") ? "check" : undefined;
const fileArg = args.indexOf("--file");
const target =
  fileArg >= 0 && args[fileArg + 1]
    ? path.resolve(args[fileArg + 1])
    : path.join(root, "docs/spec/schemas/brief.v1.json");

if (mode === undefined) {
  console.error("Usage: brief-schema.ts --write | --check [--file <path>]");
  process.exit(2);
}

const config =
  (await prettier.resolveConfig(path.join(root, "docs/spec/schemas/brief.v1.json"))) ?? {};
const expected = await prettier.format(JSON.stringify(toJsonSchema()), {
  ...config,
  parser: "json",
});

if (mode === "write") {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, expected);
  console.log(`Wrote ${path.relative(root, target)}`);
} else {
  const actual = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : undefined;
  if (actual !== expected) {
    const why = actual === undefined ? "is missing" : "differs from toJsonSchema()";
    console.error(
      `${path.relative(root, target)} ${why}. Run 'pnpm schema:write' and commit the result.`,
    );
    process.exit(1);
  }
  console.log(`${path.relative(root, target)} matches toJsonSchema().`);
}
