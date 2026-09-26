import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@faff/worker (db)",
    include: ["src/**/*.db.test.ts"],
  },
});
