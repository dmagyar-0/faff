import { defineConfig } from "vitest/config";

/**
 * Per-file coverage floors (M1 plan §7). Each PR adds the files it writes, so a threshold never
 * lands before its code. 95% on the invariant guards (acceptance, task-machine, limits, secrets,
 * citation, contact-switch); 90% on the rest of core.
 */
const core = (pct: number) => ({
  perFile: true,
  branches: pct,
  lines: pct,
  functions: pct,
  statements: pct,
});
const CORE_90 = core(90);

export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*", "evals"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**", "apps/*/src/**", "evals/src/**"],
      exclude: ["**/*.test.{ts,tsx}", "**/__selftest__/**"],
      reporter: ["text-summary", "json-summary"],
      thresholds: {
        // M1 PR 1.1: schemas and hashing.
        "packages/core/src/{acceptance-rule,brief,canonical,contact,observations,outcome}.ts":
          CORE_90,
        "packages/core/src/{practitioner,primitives,result,time}.ts": CORE_90,
      },
    },
  },
});
