import { describe, expect, it } from "vitest";

import { dependsOn, packageName } from "./index";

describe("@faff/telephony", () => {
  it("resolves its allowed workspace dependencies", () => {
    expect(packageName).toBe("@faff/telephony");
    expect(dependsOn).toEqual(["@faff/core", "@faff/sim"]);
  });
});
