import { builtinModules } from "node:module";

import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import prettier from "eslint-config-prettier";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * `packages/core` decides correctness, so it must be deterministic: no network, clock,
 * randomness, environment or database (implementation plan §2.1, M0 plan §4). Time and IDs
 * are passed in as arguments. Tests are exempt.
 */
const corePurity = {
  "no-restricted-imports": [
    "error",
    {
      paths: builtinModules.map((name) => ({
        name,
        message: "packages/core has no I/O. Pass data in as arguments.",
      })),
      patterns: [
        {
          group: ["node:*"],
          message: "packages/core has no I/O. Pass data in as arguments.",
        },
        {
          group: ["@supabase/*", "@anthropic-ai/*"],
          message: "packages/core has no I/O: no database or LLM clients.",
        },
        {
          group: ["@faff/*"],
          message: "packages/core depends on no other workspace package (spec 01).",
        },
      ],
    },
  ],
  "no-restricted-globals": [
    "error",
    ...[
      "fetch",
      "XMLHttpRequest",
      "WebSocket",
      "process",
      "crypto",
      "performance",
      "setTimeout",
      "setInterval",
      "setImmediate",
      "queueMicrotask",
      "console",
      "globalThis",
      "global",
      "window",
    ].map((name) => ({
      name,
      message: `packages/core is pure: \`${name}\` reaches outside the function. Pass what you need in as an argument.`,
    })),
  ],
  "no-restricted-properties": [
    "error",
    { object: "Date", property: "now", message: "Take `now` as an argument." },
    { object: "Math", property: "random", message: "Take randomness or IDs as arguments." },
    { object: "Temporal", property: "Now", message: "Take `now` as an argument." },
  ],
  "no-restricted-syntax": [
    "error",
    {
      selector: "NewExpression[callee.name='Date'][arguments.length=0]",
      message: "`new Date()` reads the clock. Take `now` as an argument.",
    },
    {
      selector: "CallExpression[callee.name='Date']",
      message: "`Date()` reads the clock. Take `now` as an argument.",
    },
    {
      selector: "ImportExpression",
      message: "No dynamic imports in packages/core.",
    },
  ],
};

export default defineConfig(
  {
    ignores: ["**/node_modules/", "**/.tsbuild/", "**/coverage/", "**/dist/", "**/.next/"],
  },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    files: ["**/*.{js,mjs,cjs}", "tooling/**", "*.config.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
    settings: { next: { rootDir: "apps/web" } },
  },
  {
    files: ["packages/core/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: corePurity,
  },
  prettier,
);
