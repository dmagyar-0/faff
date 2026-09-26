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

describe("wall-clock maths in Europe/London", async () => {
  const {
    addHours,
    addMinutes,
    compareDates,
    isoWeekday,
    localDateOf,
    minutesBetween,
    parseLocalDate,
    toOffsetIso,
    wallClockInstant,
  } = await import("./time");
  const TZ = "Europe/London";

  it("a skipped wall time resolves forward; a repeated one to the earlier", () => {
    expect(wallClockInstant(parseLocalDate("2026-03-29"), "01:30", TZ).toString()).toBe(
      "2026-03-29T01:30:00Z",
    );
    expect(wallClockInstant(parseLocalDate("2026-10-25"), "01:30", TZ).toString()).toBe(
      "2026-10-25T00:30:00Z",
    );
    expect(wallClockInstant(parseLocalDate("2026-07-01"), "09:00", TZ).toString()).toBe(
      "2026-07-01T08:00:00Z",
    );
  });

  it("dates, weekdays and offsets", () => {
    const at = instantOf("2026-10-31T23:30:00Z");
    expect(localDateOf(at, TZ).toString()).toBe("2026-10-31");
    expect(isoWeekday(parseLocalDate("2026-10-31"))).toBe(6);
    expect(compareDates(parseLocalDate("2026-10-31"), parseLocalDate("2026-11-01"))).toBe(-1);
    expect(toOffsetIso(instantOf("2026-10-05T08:00:00Z"), TZ)).toBe("2026-10-05T09:00:00+01:00");
    expect(toOffsetIso(instantOf("2026-12-05T08:00:00.5Z"), TZ)).toBe("2026-12-05T08:00:00+00:00");
  });

  it("minute and hour arithmetic on instants ignores DST", () => {
    const at = instantOf("2026-03-29T00:30:00Z");
    expect(addMinutes(at, 60).toString()).toBe("2026-03-29T01:30:00Z");
    expect(addHours(at, 1.5).toString()).toBe("2026-03-29T02:00:00Z");
    expect(minutesBetween(at, addMinutes(at, -15))).toBe(-15);
  });
});
