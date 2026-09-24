import { describe, expect, it } from "vitest";

import { dependsOn, packageName } from "./index";

describe("@faff/email", () => {
  it("resolves its allowed workspace dependencies", () => {
    expect(packageName).toBe("@faff/email");
    expect(dependsOn).toEqual(["@faff/core"]);
  });
});
