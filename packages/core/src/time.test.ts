import { describe, expect, it } from "vitest";

import { compareIso, instantOf, tryInstantOf } from "./time";

describe("time", () => {
  it("reads an RFC 3339 datetime as an instant, whatever its offset", () => {
    expect(instantOf("2026-10-05T09:00:00+01:00").equals(instantOf("2026-10-05T08:00:00Z"))).toBe(
      true,
    );
  });

  it("tryInstantOf returns undefined instead of throwing", () => {
    expect(tryInstantOf("2026-10-05T09:00:00")).toBeUndefined();
    expect(tryInstantOf("2026-10-05T09:00:00.1234567890Z")).toBeUndefined();
    expect(tryInstantOf("2026-10-05T09:00:00Z")).toBeDefined();
  });

  it("compareIso orders instants, not strings", () => {
    expect(compareIso("2026-10-05T09:00:00+01:00", "2026-10-05T08:30:00Z")).toBeLessThan(0);
    expect(compareIso("2026-10-05T09:00:00+01:00", "2026-10-05T08:00:00Z")).toBe(0);
    expect(compareIso("2026-10-05T09:00:00Z", "2026-10-05T08:00:00Z")).toBeGreaterThan(0);
    expect(compareIso("nonsense", "2026-10-05T08:00:00Z")).toBeUndefined();
    expect(compareIso("2026-10-05T08:00:00Z", "nonsense")).toBeUndefined();
  });
});
