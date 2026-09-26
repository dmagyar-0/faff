import { describe, expect, it } from "vitest";

import { checkHeardDate } from "./heard-date";

const TZ = "Europe/London";

describe("checkHeardDate", () => {
  it('"Tuesday the 14th" when the 14th is a Wednesday is inconsistent (spec 11)', () => {
    expect(
      checkHeardDate(
        { start: "2026-10-14T09:30:00+01:00", heard: { weekday: "tue", dayOfMonth: 14 } },
        TZ,
      ),
    ).toEqual({
      ok: false,
      reason: "inconsistent_date",
      detail: [{ field: "weekday", heard: "tue", actual: "wed" }],
    });
  });

  it("agrees when every part heard matches", () => {
    expect(
      checkHeardDate(
        {
          start: "2026-10-14T09:30:00+01:00",
          heard: { weekday: "wed", dayOfMonth: 14, month: 10 },
        },
        TZ,
      ),
    ).toEqual({ ok: true, value: true });
    expect(checkHeardDate({ start: "2026-10-14T09:30:00+01:00", heard: {} }, TZ).ok).toBe(true);
  });

  it("reports every mismatch", () => {
    const result = checkHeardDate(
      { start: "2026-10-14T09:30:00+01:00", heard: { weekday: "fri", dayOfMonth: 15, month: 11 } },
      TZ,
    );
    expect(result).toMatchObject({
      reason: "inconsistent_date",
      detail: [
        { field: "weekday", heard: "fri", actual: "wed" },
        { field: "dayOfMonth", heard: 15, actual: 14 },
        { field: "month", heard: 11, actual: 10 },
      ],
    });
  });

  it("uses the local date in the Brief's timezone, not the offset written", () => {
    // 23:30Z on 31 Oct is still 31 Oct in London (GMT), but 00:30 on 1 Nov in +01:00.
    const late = {
      start: "2026-11-01T00:30:00+01:00",
      heard: { dayOfMonth: 31, weekday: "sat" as const },
    };
    expect(checkHeardDate(late, TZ).ok).toBe(true);
    // 23:30 BST on 14 Oct is 22:30Z: still the 14th locally.
    expect(
      checkHeardDate({ start: "2026-10-14T22:30:00Z", heard: { dayOfMonth: 14 } }, TZ).ok,
    ).toBe(true);
    expect(
      checkHeardDate({ start: "2026-10-14T23:30:00Z", heard: { dayOfMonth: 14 } }, TZ).ok,
    ).toBe(false);
  });

  it("an unreadable datetime is invalid_datetime", () => {
    expect(checkHeardDate({ start: "Tuesday", heard: { weekday: "tue" } }, TZ)).toEqual({
      ok: false,
      reason: "invalid_datetime",
    });
  });
});
