import { describe, expect, it } from "vitest";

import { capabilityLine } from "./claims";

describe("claims (I-12)", () => {
  it("says the agent is an AI", () => {
    expect(capabilityLine).toMatch(/always says it's an AI/);
  });
});
