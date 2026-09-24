import { describe, expect, it } from "vitest";

import { dependsOn, packageName } from "./index";

describe("@faff/agents", () => {
  it("resolves its allowed workspace dependencies", () => {
    expect(packageName).toBe("@faff/agents");
    expect(dependsOn).toEqual(["@faff/core", "@faff/tools"]);
  });
});
