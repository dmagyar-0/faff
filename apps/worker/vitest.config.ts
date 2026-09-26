import { configDefaults, defineProject } from "vitest/config";

// `*.db.test.ts` need a running Postgres, so they have their own config (vitest.db.config.ts)
// and run in the CI `db` job, not in `pnpm test`.
export default defineProject({
  test: {
    name: "@faff/worker",
    exclude: [...configDefaults.exclude, "**/*.db.test.ts"],
  },
});
