import { describe, expect, it } from "vitest";

import { dependsOn, packageName } from "./index";

describe("@faff/core", () => {
  it("resolves its allowed workspace dependencies", () => {
    expect(packageName).toBe("@faff/core");
    expect(dependsOn).toEqual([]);
  });
});
