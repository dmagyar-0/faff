import { describe, expect, it } from "vitest";

import { dependsOn, packageName } from "./index";

describe("@faff/web", () => {
  it("resolves its allowed workspace dependencies", () => {
    expect(packageName).toBe("@faff/web");
    expect(dependsOn).toEqual(["@faff/core", "@faff/db", "@faff/agents"]);
  });
});
