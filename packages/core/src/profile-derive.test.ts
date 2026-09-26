import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { obs } from "./__fixtures__/observations";
import { deriveBusinessProfile } from "./profile-derive";
import { Temporal } from "./time";

const NOW = Temporal.Instant.from("2026-10-15T12:00:00Z");
const A = "+442079460000";
const B = "+442079460001";

describe("deriveBusinessProfile", () => {
  it("is empty for no observations", () => {
    expect(deriveBusinessProfile([], NOW)).toEqual({ derived: {}, derivedFromMaxId: undefined });
  });

  it("best phone: the most recent reached_ok number with no newer number_wrong, under 180 days old", () => {
    const rows = [
      obs(1, "reached_ok", { channel: "phone", e164: A }, "2026-09-01T10:00:00Z"),
      obs(2, "reached_ok", { channel: "phone", e164: B }, "2026-10-01T10:00:00Z"),
      obs(3, "number_wrong", { e164: B }, "2026-10-10T10:00:00Z"),
    ];
    expect(deriveBusinessProfile(rows, NOW).derived.bestPhone).toEqual({
      e164: A,
      lastReachedOkAt: "2026-09-01T10:00:00Z",
    });
    // Reached again after being marked wrong: it's good again.
    const again = [
      ...rows,
      obs(4, "reached_ok", { channel: "phone", e164: B }, "2026-10-12T10:00:00Z"),
    ];
    expect(deriveBusinessProfile(again, NOW).derived.bestPhone?.e164).toBe(B);
    // Too old.
    const old = [obs(1, "reached_ok", { channel: "phone", e164: A }, "2026-04-18T12:00:00Z")];
    expect(deriveBusinessProfile(old, NOW).derived.bestPhone).toBeUndefined();
  });

  it("the rest: email, preference, IVR hint, hours, typical hold, AI reception", () => {
    const rows = [
      obs(1, "reached_ok", { channel: "email", email: "a@smile.example" }, "2026-09-01T10:00:00Z"),
      obs(2, "prefers_email", {}, "2026-09-02T10:00:00Z"),
      obs(3, "ivr_path", { steps: [{ dtmf: "1" }] }, "2026-09-03T10:00:00Z"),
      obs(4, "ivr_path", { steps: [{ dtmf: "2" }, { say: "bookings" }] }, "2026-09-04T10:00:00Z"),
      obs(
        5,
        "opening_hours",
        { weekly: [{ day: "mon", from: "09:00", to: "17:00" }], source: "ivr" },
        "2026-09-05T10:00:00Z",
      ),
      obs(6, "refused_ai", {}, "2026-09-06T10:00:00Z"),
      obs(7, "accepted_ai", {}, "2026-09-07T10:00:00Z"),
      ...[1, 2, 3, 4].map((m, i) =>
        obs(10 + i, "hold_minutes", { minutes: m }, `2026-09-1${i}T10:00:00Z`),
      ),
    ];
    expect(deriveBusinessProfile(rows, NOW)).toEqual({
      derived: {
        bestEmail: { email: "a@smile.example", lastReachedOkAt: "2026-09-01T10:00:00Z" },
        prefersEmailObservedAt: "2026-09-02T10:00:00Z",
        ivrHint: [{ dtmf: "2" }, { say: "bookings" }],
        openingHours: [{ day: "mon", from: "09:00", to: "17:00" }],
        typicalHoldMinutes: 2.5,
        aiReception: "accepted",
      },
      derivedFromMaxId: 13,
    });
  });

  it("typical hold is the median of the last 10", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      obs(
        i + 1,
        "hold_minutes",
        { minutes: i === 0 ? 100 : i },
        `2026-09-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
      ),
    );
    // The last 10 are 2..11 minutes: median 6.5. The 100-minute outlier has aged out.
    expect(deriveBusinessProfile(rows, NOW).derived.typicalHoldMinutes).toBe(6.5);
    expect(deriveBusinessProfile(rows.slice(0, 3), NOW).derived.typicalHoldMinutes).toBe(2);
  });

  it("ignores observations dated after now", () => {
    const rows = [obs(9, "refused_ai", {}, "2026-10-16T10:00:00Z")];
    expect(deriveBusinessProfile(rows, NOW)).toEqual({ derived: {}, derivedFromMaxId: undefined });
  });

  it("property: shuffling the observations never changes the profile", () => {
    const kinds = [
      (id: number, at: string) =>
        obs(id, "reached_ok", { channel: "phone", e164: id % 2 ? A : B }, at),
      (id: number, at: string) => obs(id, "number_wrong", { e164: id % 2 ? A : B }, at),
      (id: number, at: string) =>
        obs(id, "reached_ok", { channel: "email", email: `x${id % 3}@s.example` }, at),
      (id: number, at: string) => obs(id, "hold_minutes", { minutes: id % 17 }, at),
      (id: number, at: string) => obs(id, "ivr_path", { steps: [{ dtmf: String(id % 9) }] }, at),
      (id: number, at: string) => obs(id, id % 2 ? "accepted_ai" : "refused_ai", {}, at),
      (id: number, at: string) => obs(id, "prefers_email", {}, at),
    ];
    const rowsArb = fc
      .array(fc.tuple(fc.nat({ max: kinds.length - 1 }), fc.integer({ min: 0, max: 400 })), {
        maxLength: 30,
      })
      .map((specs) =>
        specs.map(([k, daysAgo], i) =>
          (kinds[k] as (typeof kinds)[number])(
            i + 1,
            NOW.subtract({ hours: 24 * daysAgo }).toString(),
          ),
        ),
      );
    fc.assert(
      fc.property(rowsArb, fc.infiniteStream(fc.nat()), (rows, stream) => {
        const it = stream[Symbol.iterator]();
        const shuffled = [...rows].sort(() => ((it.next().value as number) % 3) - 1);
        expect(deriveBusinessProfile(shuffled, NOW)).toEqual(deriveBusinessProfile(rows, NOW));
      }),
    );
  });
});
