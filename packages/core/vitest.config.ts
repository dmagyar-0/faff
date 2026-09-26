import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    // Property tests: at least 1,000 runs each, from a fixed seed (M1 plan §7).
    setupFiles: ["./vitest.setup.ts"],
  },
});
