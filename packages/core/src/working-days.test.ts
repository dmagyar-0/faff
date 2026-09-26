import { describe, expect, it } from "vitest";

import { Temporal } from "./time";
import { addWorkingDays, isWorkingDate, withinWorkingDays } from "./working-days";

const TZ = "Europe/London";
const HOLIDAYS = ["2026-12-25", "2026-12-28", "2026-04-03", "2026-04-06"];
const at = (iso: string) => Temporal.Instant.from(iso);
const plus = (iso: string, n: number) => addWorkingDays(at(iso), n, TZ, HOLIDAYS).toString();

describe("addWorkingDays", () => {
  it("skips weekends and keeps the wall-clock time", () => {
    expect(plus("2026-10-09T15:00:00Z", 2)).toBe("2026-10-13T15:00:00Z"); // Fri 16:00 BST → Tue 16:00
    expect(plus("2026-10-10T09:00:00Z", 1)).toBe("2026-10-12T09:00:00Z"); // Sat → Mon
    expect(plus("2026-10-07T09:00:00Z", 0)).toBe("2026-10-07T09:00:00Z");
  });

  it("skips bank holidays", () => {
    // Thu 24 Dec + 2: Fri 25 (holiday), Mon 28 (substitute holiday), Tue 29, Wed 30.
    expect(plus("2026-12-24T10:00:00Z", 2)).toBe("2026-12-30T10:00:00Z");
    // Thu 2 Apr + 1 over Easter: Good Friday and Easter Monday skipped.
    expect(plus("2026-04-02T09:00:00Z", 1)).toBe("2026-04-07T09:00:00Z");
  });

  it("keeps local time across a DST change", () => {
    // Fri 23 Oct 16:00 BST (15:00Z) + 1 → Mon 26 Oct 16:00 GMT (16:00Z).
    expect(plus("2026-10-23T15:00:00Z", 1)).toBe("2026-10-26T16:00:00Z");
  });

  it("withinWorkingDays is inclusive of the deadline", () => {
    expect(
      withinWorkingDays(at("2026-10-09T15:00:00Z"), at("2026-10-13T15:00:00Z"), 2, TZ, HOLIDAYS),
    ).toBe(true);
    expect(
      withinWorkingDays(at("2026-10-09T15:00:00Z"), at("2026-10-13T15:00:01Z"), 2, TZ, HOLIDAYS),
    ).toBe(false);
  });

  it("isWorkingDate", () => {
    expect(isWorkingDate(Temporal.PlainDate.from("2026-12-25"), HOLIDAYS)).toBe(false);
    expect(isWorkingDate(Temporal.PlainDate.from("2026-12-24"), HOLIDAYS)).toBe(true);
    expect(isWorkingDate(Temporal.PlainDate.from("2026-12-26"), [])).toBe(false);
  });
});
