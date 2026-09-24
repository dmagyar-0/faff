import { describe, expect, it } from "vitest";

import { dependsOn, packageName } from "./index";

describe("@faff/tools", () => {
  it("resolves its allowed workspace dependencies", () => {
    expect(packageName).toBe("@faff/tools");
    expect(dependsOn).toEqual(["@faff/core", "@faff/db"]);
  });
});
