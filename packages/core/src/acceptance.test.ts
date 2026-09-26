import { describe, expect, it } from "vitest";

import { AcceptanceRule, type Window } from "./acceptance-rule";
import {
  type AcceptanceContext,
  type BusyInterval,
  evaluateAcceptance,
  pickPreferred,
  rankByPreference,
} from "./acceptance";
import type { Slot, Weekday } from "./primitives";
import { instantOf } from "./time";

const TZ = "Europe/London" as const;
const ctx = (overrides: Partial<AcceptanceContext> = {}): AcceptanceContext => ({
  now: instantOf("2026-01-01T00:00:00Z"),
  timezone: TZ,
  ...overrides,
});
const rule = (windows: Window[], extra: Partial<AcceptanceRule> = {}): AcceptanceRule =>
  AcceptanceRule.parse({
    windows,
    avoidCalendarConflicts: false,
    preference: "earliest",
    ...extra,
  });
const absolute = (start: string, end: string): Window => ({ kind: "absolute", start, end });
const recurring = (
  from: string,
  to: string,
  between: [string, string],
  days: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
): Window => ({
  kind: "recurring",
  days,
  from,
  to,
  between: { start: between[0], end: between[1] },
});

const kind = (r: AcceptanceRule, slot: Slot, busy: BusyInterval[] = [], c = ctx()) =>
  evaluateAcceptance(r, slot, busy, c).kind;

describe("named DST and midnight cases (M1 plan §3.4)", () => {
  // Europe/London 2026: clocks go forward at 01:00 GMT on Sun 29 Mar, back at 02:00 BST on Sun 25 Oct.

  it("spring-forward day, absolute window: the same slot in either offset is accepted", () => {
    const r = rule([absolute("2026-03-29T00:00:00+00:00", "2026-03-29T04:00:00+01:00")]);
    expect(kind(r, { start: "2026-03-29T02:30:00+01:00", end: "2026-03-29T03:30:00+01:00" })).toBe(
      "accept",
    );
    expect(kind(r, { start: "2026-03-29T01:30:00Z", end: "2026-03-29T02:30:00Z" })).toBe("accept");
    expect(kind(r, { start: "2026-03-29T03:30:00+01:00", end: "2026-03-29T04:30:00+01:00" })).toBe(
      "outside_rule",
    );
  });

  it("spring-forward day, recurring window: a start time that doesn't exist resolves forward", () => {
    // 01:30 doesn't exist on 29 Mar 2026; it resolves to 02:30 BST (01:30Z). 03:00 BST is 02:00Z.
    const r = rule([recurring("01:30", "03:00", ["2026-03-29", "2026-03-29"])]);
    expect(kind(r, { start: "2026-03-29T02:30:00+01:00", end: "2026-03-29T03:00:00+01:00" })).toBe(
      "accept",
    );
    expect(kind(r, { start: "2026-03-29T01:00:00Z", end: "2026-03-29T01:45:00Z" })).toBe(
      "outside_rule",
    );
  });

  it("fall-back day, absolute window: the second 01:30 is inside an instant-bounded window", () => {
    const r = rule([absolute("2026-10-25T01:00:00+01:00", "2026-10-25T01:59:00+00:00")]);
    expect(kind(r, { start: "2026-10-25T01:30:00+00:00", end: "2026-10-25T01:50:00+00:00" })).toBe(
      "accept",
    );
    expect(kind(r, { start: "2026-10-25T00:30:00Z", end: "2026-10-25T00:50:00Z" })).toBe("accept");
  });

  it("fall-back day, recurring window: a repeated start time resolves to the earlier one", () => {
    // 01:00 happens twice; the window starts at the first (00:00Z) and ends at 02:00 GMT (02:00Z).
    const r = rule([recurring("01:00", "02:00", ["2026-10-25", "2026-10-25"])]);
    expect(kind(r, { start: "2026-10-25T01:00:00+01:00", end: "2026-10-25T01:30:00+01:00" })).toBe(
      "accept",
    );
    expect(kind(r, { start: "2026-10-25T01:30:00+00:00", end: "2026-10-25T02:00:00+00:00" })).toBe(
      "accept",
    );
    expect(kind(r, { start: "2026-10-25T01:45:00+00:00", end: "2026-10-25T02:15:00+00:00" })).toBe(
      "outside_rule",
    );
  });

  it("22:00–02:00 window on the spring-forward night: the lost hour shortens it to three", () => {
    // Sat 28 Mar 22:00 GMT (22:00Z) to Sun 02:00 BST (01:00Z): 01:00–01:59 never happens.
    const r = rule([recurring("22:00", "02:00", ["2026-03-28", "2026-03-28"], ["sat"])]);
    expect(kind(r, { start: "2026-03-29T00:00:00Z", end: "2026-03-29T02:00:00+01:00" })).toBe(
      "accept",
    );
    expect(kind(r, { start: "2026-03-29T00:30:00Z", end: "2026-03-29T01:30:00Z" })).toBe(
      "outside_rule",
    );
    expect(kind(r, { start: "2026-03-29T02:00:00+01:00", end: "2026-03-29T02:30:00+01:00" })).toBe(
      "outside_rule",
    );
  });

  it("22:00–02:00 window on the fall-back night: it runs five real hours", () => {
    // Sat 24 Oct 22:00 BST (21:00Z) to Sun 02:00 GMT (02:00Z).
    const r = rule([recurring("22:00", "02:00", ["2026-10-24", "2026-10-24"], ["sat"])]);
    expect(kind(r, { start: "2026-10-24T21:00:00Z", end: "2026-10-24T21:30:00Z" })).toBe("accept");
    expect(kind(r, { start: "2026-10-25T01:30:00+00:00", end: "2026-10-25T02:00:00+00:00" })).toBe(
      "accept",
    );
    expect(kind(r, { start: "2026-10-25T01:45:00+00:00", end: "2026-10-25T02:15:00+00:00" })).toBe(
      "outside_rule",
    );
  });

  it("a slot ending exactly at a window edge is accepted; one minute over is not", () => {
    const r = rule([absolute("2026-10-05T09:00:00+01:00", "2026-10-05T12:00:00+01:00")]);
    expect(kind(r, { start: "2026-10-05T11:30:00+01:00", end: "2026-10-05T12:00:00+01:00" })).toBe(
      "accept",
    );
    expect(kind(r, { start: "2026-10-05T11:31:00+01:00", end: "2026-10-05T12:01:00+01:00" })).toBe(
      "outside_rule",
    );
    expect(kind(r, { start: "2026-10-05T09:00:00+01:00" })).toBe("accept");
    expect(kind(r, { start: "2026-10-05T08:59:00+01:00" })).toBe("outside_rule");
  });

  it("a slot at 23:30 on the between.end date is accepted (inclusive dates, G17)", () => {
    const r = rule([recurring("18:00", "00:00", ["2026-10-01", "2026-10-31"])]);
    expect(kind(r, { start: "2026-10-31T23:30:00+00:00", end: "2026-11-01T00:00:00+00:00" })).toBe(
      "accept",
    );
    expect(kind(r, { start: "2026-11-01T18:30:00+00:00" })).toBe("outside_rule");
    expect(kind(r, { start: "2026-10-01T18:00:00+01:00" })).toBe("accept");
    expect(kind(r, { start: "2026-09-30T18:00:00+01:00" })).toBe("outside_rule");
  });

  it("two adjacent windows: a slot spanning both is accepted (windows are a union)", () => {
    const r = rule([
      absolute("2026-10-05T09:00:00+01:00", "2026-10-05T10:00:00+01:00"),
      absolute("2026-10-05T10:00:00+01:00", "2026-10-05T11:00:00+01:00"),
    ]);
    expect(kind(r, { start: "2026-10-05T09:30:00+01:00", end: "2026-10-05T10:30:00+01:00" })).toBe(
      "accept",
    );
    const gap = rule([
      absolute("2026-10-05T09:00:00+01:00", "2026-10-05T10:00:00+01:00"),
      absolute("2026-10-05T10:01:00+01:00", "2026-10-05T11:00:00+01:00"),
    ]);
    expect(
      kind(gap, { start: "2026-10-05T09:30:00+01:00", end: "2026-10-05T10:30:00+01:00" }),
    ).toBe("outside_rule");
  });

  it("an absolute and a recurring window join up too", () => {
    const r = rule([
      absolute("2026-10-05T08:00:00+01:00", "2026-10-05T09:00:00+01:00"),
      recurring("09:00", "12:00", ["2026-10-01", "2026-10-31"], ["mon"]),
    ]);
    expect(kind(r, { start: "2026-10-05T08:30:00+01:00", end: "2026-10-05T09:30:00+01:00" })).toBe(
      "accept",
    );
  });

  it("a buffer exactly touching a busy block is accepted; a minute into it is not", () => {
    const r = rule([absolute("2026-10-05T09:00:00+01:00", "2026-10-05T18:00:00+01:00")], {
      avoidCalendarConflicts: true,
      bufferMinutes: 30,
    });
    const busy = [{ start: "2026-10-05T12:00:00+01:00", end: "2026-10-05T13:00:00+01:00" }];
    expect(kind(r, { start: "2026-10-05T13:30:00+01:00" }, busy)).toBe("accept");
    expect(
      kind(r, { start: "2026-10-05T11:00:00+01:00", end: "2026-10-05T11:30:00+01:00" }, busy),
    ).toBe("accept");
    expect(kind(r, { start: "2026-10-05T13:29:00+01:00" }, busy)).toBe("outside_rule");
    expect(
      kind(r, { start: "2026-10-05T11:01:00+01:00", end: "2026-10-05T11:31:00+01:00" }, busy),
    ).toBe("outside_rule");
  });

  it("windows join across midnight: a slot from one day's window into the next day's", () => {
    // Sat 20:00–00:00 and Sun 00:00–03:00, in BST so local and UTC dates differ.
    const r = rule([
      recurring("20:00", "00:00", ["2026-10-03", "2026-10-03"], ["sat"]),
      recurring("00:00", "03:00", ["2026-10-04", "2026-10-04"], ["sun"]),
    ]);
    expect(kind(r, { start: "2026-10-03T23:30:00+01:00", end: "2026-10-04T00:30:00+01:00" })).toBe(
      "accept",
    );
    expect(kind(r, { start: "2026-10-04T02:30:00+01:00", end: "2026-10-04T03:30:00+01:00" })).toBe(
      "outside_rule",
    );
  });

  it("a window nested inside another doesn't shrink it", () => {
    const r = rule([
      absolute("2026-10-05T09:00:00+01:00", "2026-10-05T17:00:00+01:00"),
      absolute("2026-10-05T10:00:00+01:00", "2026-10-05T11:00:00+01:00"),
    ]);
    expect(kind(r, { start: "2026-10-05T12:00:00+01:00" })).toBe("accept");
  });

  it("each 2027 and 2028 transition behaves the same way", () => {
    for (const [spring, fall] of [
      ["2027-03-28", "2027-10-31"],
      ["2028-03-26", "2028-10-29"],
    ] as const) {
      const gap = rule([recurring("01:30", "03:00", [spring, spring])]);
      expect(kind(gap, { start: `${spring}T01:30:00Z`, end: `${spring}T02:00:00Z` })).toBe(
        "accept",
      );
      const overlap = rule([recurring("01:00", "02:00", [fall, fall])]);
      expect(kind(overlap, { start: `${fall}T00:00:00Z`, end: `${fall}T02:00:00Z` })).toBe(
        "accept",
      );
    }
  });
});

describe("evaluateAcceptance", () => {
  const monday = rule([recurring("09:00", "17:00", ["2026-10-01", "2026-10-31"], ["mon"])]);

  describe("reject: not a real offer", () => {
    it.each([
      ["no offset", { start: "2026-10-05T10:00:00" }],
      ["not a datetime", { start: "Tuesday" }],
      [
        "an end before the start",
        { start: "2026-10-05T10:00:00+01:00", end: "2026-10-05T09:00:00+01:00" },
      ],
      [
        "an end equal to the start",
        { start: "2026-10-05T10:00:00+01:00", end: "2026-10-05T10:00:00+01:00" },
      ],
      ["an unreadable end", { start: "2026-10-05T10:00:00+01:00", end: "10:30" }],
      [
        "a slot over 24 hours long",
        { start: "2026-10-05T10:00:00+01:00", end: "2026-10-06T10:01:00+01:00" },
      ],
    ])("%s → invalid_slot", (_label, slot) => {
      expect(evaluateAcceptance(monday, slot, [], ctx())).toEqual({
        kind: "reject",
        reason: "invalid_slot",
      });
    });

    it("boundaries: a slot starting exactly now, and one exactly 24 hours long, are real offers", () => {
      const wide = rule([absolute("2026-10-05T00:00:00Z", "2026-10-07T00:00:00Z")]);
      const now = instantOf("2026-10-05T10:00:00Z");
      expect(kind(wide, { start: "2026-10-05T10:00:00Z" }, [], ctx({ now }))).toBe("accept");
      expect(
        kind(
          wide,
          { start: "2026-10-05T10:00:00Z", end: "2026-10-06T10:00:00Z" },
          [],
          ctx({ now }),
        ),
      ).toBe("accept");
    });

    it("a slot in the past → in_past", () => {
      const result = evaluateAcceptance(
        monday,
        { start: "2026-10-05T10:00:00+01:00" },
        [],
        ctx({ now: instantOf("2026-10-05T10:00:01+01:00") }),
      );
      expect(result).toEqual({ kind: "reject", reason: "in_past" });
    });

    it("a date that contradicts what was heard → inconsistent_date, with the mismatch", () => {
      // "Tuesday the 14th": 14 Oct 2026 is a Wednesday.
      const result = evaluateAcceptance(
        rule([absolute("2026-10-01T00:00:00Z", "2026-10-31T00:00:00Z")]),
        { start: "2026-10-14T10:00:00+01:00" },
        [],
        ctx({ heard: { weekday: "tue", dayOfMonth: 14 } }),
      );
      expect(result).toEqual({
        kind: "reject",
        reason: "inconsistent_date",
        mismatches: [{ field: "weekday", heard: "tue", actual: "wed" }],
      });
    });

    it("a date that agrees with what was heard goes on to be evaluated", () => {
      const result = evaluateAcceptance(
        rule([absolute("2026-10-01T00:00:00Z", "2026-10-31T00:00:00Z")]),
        { start: "2026-10-14T10:00:00+01:00" },
        [],
        ctx({ heard: { weekday: "wed", dayOfMonth: 14, month: 10 } }),
      );
      expect(result.kind).toBe("accept");
    });

    it("an unreadable start with something heard is still invalid_slot", () => {
      const result = evaluateAcceptance(
        monday,
        { start: "soon" },
        [],
        ctx({ heard: { weekday: "mon" } }),
      );
      expect(result).toEqual({ kind: "reject", reason: "invalid_slot" });
    });
  });

  describe("outside_rule: a real offer the rule doesn't allow", () => {
    it("reports every reason at once, with the slot as evaluated", () => {
      const r = rule([recurring("09:00", "17:00", ["2026-10-01", "2026-10-31"], ["mon"])], {
        avoidCalendarConflicts: true,
        minNoticeHours: 48,
        practitioner: { mustBe: "Dr Patel" },
      });
      const result = evaluateAcceptance(
        r,
        { start: "2026-10-06T10:00:00+01:00", practitioner: "Dr Jones" },
        [{ start: "2026-10-06T10:00:00+01:00", end: "2026-10-06T11:00:00+01:00" }],
        ctx({ now: instantOf("2026-10-05T12:00:00+01:00") }),
      );
      expect(result).toEqual({
        kind: "outside_rule",
        slot: {
          start: "2026-10-06T10:00:00+01:00",
          end: "2026-10-06T10:30:00+01:00",
          practitioner: "Dr Jones",
        },
        reasons: ["not_in_window", "calendar_conflict", "too_soon", "practitioner_mismatch"],
      });
    });

    it("too_soon uses minNoticeHours from now; exactly on the notice is fine", () => {
      const r = rule([absolute("2026-10-05T00:00:00Z", "2026-10-10T00:00:00Z")], {
        minNoticeHours: 2.5,
      });
      const now = instantOf("2026-10-05T09:00:00Z");
      expect(kind(r, { start: "2026-10-05T11:30:00Z" }, [], ctx({ now }))).toBe("accept");
      expect(kind(r, { start: "2026-10-05T11:29:00Z" }, [], ctx({ now }))).toBe("outside_rule");
    });

    it("uses the service's duration for a slot without an end", () => {
      const r = rule([absolute("2026-10-05T09:00:00Z", "2026-10-05T10:00:00Z")]);
      expect(
        kind(r, { start: "2026-10-05T09:15:00Z" }, [], ctx({ defaultDurationMinutes: 45 })),
      ).toBe("accept");
      expect(
        kind(r, { start: "2026-10-05T09:15:00Z" }, [], ctx({ defaultDurationMinutes: 46 })),
      ).toBe("outside_rule");
      expect(evaluateAcceptance(r, { start: "2026-10-05T09:15:00Z" }, [], ctx())).toMatchObject({
        slot: { end: "2026-10-05T10:45:00+01:00" },
      });
    });

    describe("practitioner", () => {
      const r = (practitioner: AcceptanceRule["practitioner"]) =>
        rule([absolute("2026-10-05T00:00:00Z", "2026-10-06T00:00:00Z")], { practitioner });
      const at = (practitioner?: string): Slot =>
        practitioner === undefined
          ? { start: "2026-10-05T10:00:00Z" }
          : { start: "2026-10-05T10:00:00Z", practitioner };
      const reasons = (result: ReturnType<typeof evaluateAcceptance>) =>
        result.kind === "outside_rule" ? result.reasons : [];

      it("mustBe matches ignoring case, titles and punctuation", () => {
        expect(evaluateAcceptance(r({ mustBe: "Dr Patel" }), at("patel"), [], ctx()).kind).toBe(
          "accept",
        );
        expect(
          reasons(evaluateAcceptance(r({ mustBe: "Dr Patel" }), at("Dr Jones"), [], ctx())),
        ).toEqual(["practitioner_mismatch"]);
      });

      it("avoid rules a practitioner out", () => {
        expect(
          reasons(evaluateAcceptance(r({ avoid: ["Jones"] }), at("Dr. Jones"), [], ctx())),
        ).toEqual(["practitioner_avoided"]);
        expect(evaluateAcceptance(r({ avoid: ["Jones"] }), at("Dr Patel"), [], ctx()).kind).toBe(
          "accept",
        );
      });

      it("an unnamed or title-only practitioner is unknown when the rule cares", () => {
        expect(reasons(evaluateAcceptance(r({ mustBe: "Patel" }), at(), [], ctx()))).toEqual([
          "practitioner_unknown",
        ]);
        expect(reasons(evaluateAcceptance(r({ avoid: ["Jones"] }), at("Dr"), [], ctx()))).toEqual([
          "practitioner_unknown",
        ]);
        expect(evaluateAcceptance(r(undefined), at(), [], ctx()).kind).toBe("accept");
        expect(evaluateAcceptance(r({ avoid: [] }), at(), [], ctx()).kind).toBe("accept");
      });
    });

    describe("calendar", () => {
      const r = (avoidCalendarConflicts: boolean) =>
        rule([absolute("2026-10-05T08:00:00Z", "2026-10-05T18:00:00Z")], {
          avoidCalendarConflicts,
          bufferMinutes: 0,
        });
      const busy = [{ start: "2026-10-05T10:00:00Z", end: "2026-10-05T11:00:00Z" }];

      it("is ignored when the rule doesn't ask for it (stated windows work alone, Q12)", () => {
        expect(kind(r(false), { start: "2026-10-05T10:00:00Z" }, busy)).toBe("accept");
        expect(
          kind(r(false), { start: "2026-10-05T10:00:00Z" }, [{ start: "bad", end: "bad" }]),
        ).toBe("accept");
      });

      it("a zero-length busy block is readable, and clashes when inside the slot", () => {
        const point = [{ start: "2026-10-05T10:15:00Z", end: "2026-10-05T10:15:00Z" }];
        expect(
          evaluateAcceptance(r(true), { start: "2026-10-05T10:00:00Z" }, point, ctx()),
        ).toMatchObject({
          reasons: ["calendar_conflict"],
        });
      });

      it("an unreadable busy block means the slot can't be accepted", () => {
        const result = evaluateAcceptance(
          r(true),
          { start: "2026-10-05T14:00:00Z" },
          [{ start: "x", end: "y" }],
          ctx(),
        );
        expect(result).toMatchObject({ kind: "outside_rule", reasons: ["calendar_unreadable"] });
        const backwards = [{ start: "2026-10-05T12:00:00Z", end: "2026-10-05T11:00:00Z" }];
        expect(
          evaluateAcceptance(r(true), { start: "2026-10-05T14:00:00Z" }, backwards, ctx()),
        ).toMatchObject({
          reasons: ["calendar_unreadable"],
        });
      });

      it("a reschedule ignores the busy block that is its own existing appointment", () => {
        const existing = {
          startsAt: "2026-10-05T11:00:00+01:00",
          endsAt: "2026-10-05T12:00:00+01:00",
        };
        const withBuffer = rule([absolute("2026-10-05T08:00:00Z", "2026-10-05T18:00:00Z")], {
          avoidCalendarConflicts: true,
        });
        const slot = { start: "2026-10-05T11:15:00Z" };
        expect(kind(withBuffer, slot, busy, ctx())).toBe("outside_rule");
        expect(kind(withBuffer, slot, busy, ctx({ existingAppointment: existing }))).toBe("accept");
        // Without an end, the block must run from its start for the service's duration.
        const noEnd = { startsAt: existing.startsAt };
        expect(
          kind(
            withBuffer,
            slot,
            busy,
            ctx({ existingAppointment: noEnd, defaultDurationMinutes: 60 }),
          ),
        ).toBe("accept");
        expect(
          kind(
            withBuffer,
            slot,
            busy,
            ctx({ existingAppointment: noEnd, defaultDurationMinutes: 30 }),
          ),
        ).toBe("outside_rule");
        // A block that only shares the start is someone else's event.
        const other = { startsAt: existing.startsAt, endsAt: "2026-10-05T12:30:00+01:00" };
        expect(kind(withBuffer, slot, busy, ctx({ existingAppointment: other }))).toBe(
          "outside_rule",
        );
      });
    });
  });

  it("a clash with any busy block counts, whatever the order of the list", () => {
    const r = rule([absolute("2026-10-05T08:00:00Z", "2026-10-05T18:00:00Z")], {
      avoidCalendarConflicts: true,
      bufferMinutes: 0,
    });
    const clashing = { start: "2026-10-05T10:00:00Z", end: "2026-10-05T11:00:00Z" };
    const later = { start: "2026-10-05T15:00:00Z", end: "2026-10-05T16:00:00Z" };
    const slot = { start: "2026-10-05T10:15:00Z" };
    expect(kind(r, slot, [clashing, later])).toBe("outside_rule");
    expect(kind(r, slot, [later, clashing])).toBe("outside_rule");
  });

  it("the existing appointment is ignored once: a second identical block still clashes", () => {
    const r = rule([absolute("2026-10-05T08:00:00Z", "2026-10-05T18:00:00Z")], {
      avoidCalendarConflicts: true,
      bufferMinutes: 0,
    });
    const block = { start: "2026-10-05T10:00:00Z", end: "2026-10-05T11:00:00Z" };
    const existing = { startsAt: block.start, endsAt: block.end };
    const slot = { start: "2026-10-05T10:15:00Z" };
    expect(kind(r, slot, [block], ctx({ existingAppointment: existing }))).toBe("accept");
    expect(kind(r, slot, [block, block], ctx({ existingAppointment: existing }))).toBe(
      "outside_rule",
    );
  });

  it("ignores a service duration that isn't a sensible whole number of minutes", () => {
    const r = rule([absolute("2026-10-05T09:00:00Z", "2026-10-05T09:30:00Z")]);
    for (const d of [0.5, Number.NaN, -10, 0, 100_000]) {
      expect(
        kind(r, { start: "2026-10-05T09:00:00Z" }, [], ctx({ defaultDurationMinutes: d })),
      ).toBe("accept");
    }
  });

  it("keeps fractions of a second, so the returned slot names the instant evaluated", () => {
    const r = rule([absolute("2026-10-05T09:00:00.5Z", "2026-10-05T10:00:00Z")]);
    const result = evaluateAcceptance(
      r,
      { start: "2026-10-05T09:00:00.5Z" },
      [],
      ctx({ now: instantOf("2026-10-05T09:00:00.3Z") }),
    );
    expect(result).toMatchObject({
      kind: "accept",
      slot: { start: "2026-10-05T10:00:00.5+01:00" },
    });
  });

  it("returns the slot in the Brief's timezone's offset", () => {
    const result = evaluateAcceptance(monday, { start: "2026-10-05T09:00:00Z" }, [], ctx());
    expect(result).toEqual({
      kind: "accept",
      slot: { start: "2026-10-05T10:00:00+01:00", end: "2026-10-05T10:30:00+01:00" },
    });
  });
});

describe("rankByPreference and pickPreferred (M1-Q9: code picks)", () => {
  const slots = [
    { start: "2026-10-07T10:00:00+01:00", id: "wed" },
    { start: "2026-10-05T09:00:00Z", id: "mon" },
    { start: "2026-10-06T15:00:00+01:00", id: "tue" },
    { start: "2026-10-06T14:00:00Z", id: "tue-again" },
  ];
  const ids = (xs: { id: string }[]) => xs.map((s) => s.id);

  it("earliest and latest order by instant, ties in offered order", () => {
    expect(ids(rankByPreference("earliest", slots))).toEqual(["mon", "tue", "tue-again", "wed"]);
    expect(ids(rankByPreference("latest", slots))).toEqual(["wed", "tue", "tue-again", "mon"]);
  });

  it("closestTo orders by distance, ties to the earlier slot", () => {
    const pref = { closestTo: "2026-10-06T12:00:00+01:00" };
    expect(ids(rankByPreference(pref, slots))).toEqual(["tue", "tue-again", "wed", "mon"]);
    const tie = [
      { start: "2026-10-06T13:00:00+01:00", id: "after" },
      { start: "2026-10-06T11:00:00+01:00", id: "before" },
    ];
    expect(pickPreferred(pref, tie)?.id).toBe("before");
  });

  it("puts unreadable starts last and handles an empty list", () => {
    expect(ids(rankByPreference("earliest", [{ start: "x", id: "bad" }, ...slots]))).toEqual([
      "mon",
      "tue",
      "tue-again",
      "wed",
      "bad",
    ]);
    expect(
      ids(
        rankByPreference("latest", [
          { start: "x", id: "b1" },
          { start: "y", id: "b2" },
        ]),
      ),
    ).toEqual(["b1", "b2"]);
    expect(pickPreferred("earliest", [])).toBeUndefined();
  });

  it("does not modify its input", () => {
    const copy = [...slots];
    rankByPreference("latest", slots);
    expect(slots).toEqual(copy);
  });
});
