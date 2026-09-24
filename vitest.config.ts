import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*", "evals"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**", "apps/*/src/**", "evals/src/**"],
      exclude: ["**/*.test.ts", "**/__selftest__/**"],
      reporter: ["text-summary", "json-summary"],
      // Per-file thresholds arrive with the code they cover (M1 onwards).
    },
  },
});
