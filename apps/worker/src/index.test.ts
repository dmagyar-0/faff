import { describe, expect, it } from "vitest";

import { dependsOn, packageName } from "./index";

describe("@faff/worker", () => {
  it("resolves its allowed workspace dependencies", () => {
    expect(packageName).toBe("@faff/worker");
    expect(dependsOn).toEqual([
      "@faff/core",
      "@faff/db",
      "@faff/tools",
      "@faff/agents",
      "@faff/telephony",
      "@faff/email",
      "@faff/sim",
    ]);
  });
});
