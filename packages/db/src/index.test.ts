import { describe, expect, it } from "vitest";

import { dependsOn, packageName } from "./index";

describe("@faff/db", () => {
  it("resolves its allowed workspace dependencies", () => {
    expect(packageName).toBe("@faff/db");
    expect(dependsOn).toEqual(["@faff/core"]);
  });
});
