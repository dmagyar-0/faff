import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { type AcceptanceResult, type BusyInterval, evaluateAcceptance } from "./acceptance";
import { AcceptanceRule, type Window } from "./acceptance-rule";
import { WEEKDAYS, type Slot } from "./primitives";
import { Temporal, type Instant } from "./time";

const TZ = "Europe/London" as const;
const MINUTE = 60_000;
const FROM = Date.UTC(2026, 0, 1);
const TO = Date.UTC(2029, 0, 1);
/** Every Europe/London clock change in range, so the arbitraries can crowd around them. */
const TRANSITIONS = [
  "2026-03-29T01:00:00Z",
  "2026-10-25T01:00:00Z",
  "2027-03-28T01:00:00Z",
  "2027-10-31T01:00:00Z",
  "2028-03-26T01:00:00Z",
  "2028-10-29T01:00:00Z",
].map((iso) => Date.parse(iso));

/** Minute-aligned instants across 2026–2028, half of them within a day of a DST change. */
const instantArb: fc.Arbitrary<Instant> = fc
  .oneof(
    fc.integer({ min: FROM / MINUTE, max: TO / MINUTE }).map((m) => m * MINUTE),
    fc
      .tuple(fc.constantFrom(...TRANSITIONS), fc.integer({ min: -24 * 60, max: 24 * 60 }))
      .map(([t, m]) => t + m * MINUTE),
  )
  .map((ms) => Temporal.Instant.fromEpochMilliseconds(ms));

const OFFSETS = ["Z", "+00:00", "+01:00", "-05:00", "+05:30", "+14:00", "-12:00"] as const;
const write = (at: Instant, offset: (typeof OFFSETS)[number]): string =>
  offset === "Z"
    ? at.toString({ smallestUnit: "second" })
    : at.toZonedDateTimeISO(offset).toString({ timeZoneName: "never", smallestUnit: "second" });

const wallTime = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.constantFrom(0, 15, 30, 45, 59))
  .map(([h, m]) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
const localDate = instantArb.map((at) => at.toZonedDateTimeISO(TZ).toPlainDate().toString());

const windowArb: fc.Arbitrary<Window> = fc.oneof(
  fc.tuple(instantArb, fc.integer({ min: 1, max: 14 * 24 * 60 })).map(([at, minutes]) => ({
    kind: "absolute" as const,
    start: write(at, "+01:00"),
    end: write(at.add({ minutes }), "Z"),
  })),
  fc
    .record({
      days: fc.subarray([...WEEKDAYS], { minLength: 1 }),
      from: wallTime,
      to: wallTime,
      a: localDate,
      b: localDate,
    })
    .filter(({ from, to }) => from !== to)
    .map(({ days, from, to, a, b }) => ({
      kind: "recurring" as const,
      days,
      from,
      to,
      between: a <= b ? { start: a, end: b } : { start: b, end: a },
    })),
);

const ruleArb = fc
  .record({
    windows: fc.array(windowArb, { minLength: 1, maxLength: 4 }),
    avoidCalendarConflicts: fc.boolean(),
    bufferMinutes: fc.integer({ min: 0, max: 120 }),
    minNoticeHours: fc.option(fc.integer({ min: 0, max: 72 }), { nil: undefined }),
    practitioner: fc.option(
      fc.record(
        {
          mustBe: fc.constantFrom("Dr Patel", "Jones"),
          avoid: fc.subarray(["Patel", "Dr Jones", "Lee"]),
        },
        { requiredKeys: [] },
      ),
      { nil: undefined },
    ),
  })
  .map((r) => AcceptanceRule.parse({ ...r, preference: "earliest" }));

type SlotSpec = { at: Instant; minutes: number | undefined; practitioner: string | undefined };
const slotArb: fc.Arbitrary<SlotSpec> = fc.record({
  at: instantArb,
  minutes: fc.option(fc.integer({ min: 1, max: 300 }), { nil: undefined }),
  practitioner: fc.option(fc.constantFrom("Dr Patel", "jones", "Lee", "Dr"), { nil: undefined }),
});
const toSlot = (s: SlotSpec, offset: (typeof OFFSETS)[number]): Slot => ({
  start: write(s.at, offset),
  ...(s.minutes === undefined ? {} : { end: write(s.at.add({ minutes: s.minutes }), offset) }),
  ...(s.practitioner === undefined ? {} : { practitioner: s.practitioner }),
});

const busyArb: fc.Arbitrary<BusyInterval> = fc
  .tuple(instantArb, fc.integer({ min: 0, max: 600 }))
  .map(([at, minutes]) => ({ start: write(at, "Z"), end: write(at.add({ minutes }), "+01:00") }));
const busyListArb = fc.array(busyArb, { maxLength: 4 });
const nowArb = instantArb;

/**
 * A rule with a slot near one of its windows and a `now` a little before it, so a good share of
 * cases are accepted and the monotonicity properties have something to hold on to.
 */
const scenarioArb = ruleArb.chain((rule) =>
  fc
    .record({
      window: fc.constantFrom(...rule.windows),
      dayOffset: fc.nat({ max: 30 }),
      minuteOffset: fc.integer({ min: -90, max: 240 }),
      minutes: fc.option(fc.integer({ min: 1, max: 120 }), { nil: undefined }),
      practitioner: fc.option(fc.constantFrom("Dr Patel", "jones", "Lee", "Dr"), {
        nil: undefined,
      }),
      lead: fc.integer({ min: 0, max: 96 * 60 }),
    })
    .map(({ window, dayOffset, minuteOffset, minutes, practitioner, lead }) => {
      const anchor =
        window.kind === "absolute"
          ? Temporal.Instant.from(window.start)
          : Temporal.PlainDate.from(window.between.start)
              .add({ days: dayOffset })
              .toZonedDateTime({ timeZone: TZ, plainTime: Temporal.PlainTime.from(window.from) })
              .toInstant();
      const at = anchor.add({ minutes: minuteOffset });
      const spec: SlotSpec = { at, minutes, practitioner };
      return { rule, spec, now: at.subtract({ minutes: lead }) };
    }),
);

const run = (
  rule: AcceptanceRule,
  slot: Slot,
  busy: BusyInterval[],
  now: Instant,
): AcceptanceResult =>
  evaluateAcceptance(rule, slot, busy, { now, timezone: TZ, defaultDurationMinutes: 30 });

describe("evaluateAcceptance properties (fast-check, 2026–2028, both DST changes each year)", () => {
  it("the same instant written in any offset gets the same result", () => {
    fc.assert(
      fc.property(
        fc.oneof(scenarioArb, fc.record({ rule: ruleArb, spec: slotArb, now: nowArb })),
        busyListArb,
        fc.constantFrom(...OFFSETS),
        fc.constantFrom(...OFFSETS),
        ({ rule, spec, now }, busy, o1, o2) => {
          expect(run(rule, toSlot(spec, o1), busy, now)).toEqual(
            run(rule, toSlot(spec, o2), busy, now),
          );
        },
      ),
    );
  });

  it("the scenarios produce plenty of accepts and outside_rules (so the properties aren't vacuous)", () => {
    const kinds = fc
      .sample(fc.tuple(scenarioArb, busyListArb), { numRuns: 2000, seed: 1 })
      .map(([{ rule, spec, now }, busy]) => run(rule, toSlot(spec, "Z"), busy, now).kind);
    for (const k of ["accept", "outside_rule"] as const) {
      expect(kinds.filter((x) => x === k).length).toBeGreaterThan(100);
    }
  });

  /** A busy block within a couple of hours of the slot, so it has a real chance to clash. */
  const nearBusy = (spec: SlotSpec): fc.Arbitrary<BusyInterval> =>
    fc
      .tuple(fc.integer({ min: -180, max: 180 }), fc.integer({ min: 0, max: 240 }))
      .map(([offset, minutes]) => {
        const start = spec.at.add({ minutes: offset });
        return { start: write(start, "Z"), end: write(start.add({ minutes }), "+01:00") };
      });
  /** An extra absolute window overlapping or nested around the slot, so the union is exercised. */
  const nearWindow = (spec: SlotSpec): fc.Arbitrary<Window> =>
    fc
      .tuple(fc.integer({ min: -240, max: 60 }), fc.integer({ min: 1, max: 480 }))
      .map(([offset, minutes]) => {
        const start = spec.at.add({ minutes: offset });
        return {
          kind: "absolute",
          start: write(start, "Z"),
          end: write(start.add({ minutes }), "+01:00"),
        };
      });
  /** Scenarios whose rule checks the calendar, with busy blocks near the slot. */
  const calendarScenarioArb = scenarioArb.chain((s) =>
    fc.record({
      scenario: fc.constant({ ...s, rule: { ...s.rule, avoidCalendarConflicts: true } }),
      busy: fc.array(nearBusy(s.spec), { maxLength: 1 }),
      extra: nearBusy(s.spec),
    }),
  );

  it("adding a busy interval never turns a non-accept into accept", () => {
    fc.assert(
      fc.property(calendarScenarioArb, ({ scenario: { rule, spec, now }, busy, extra }) => {
        const slot = toSlot(spec, "Z");
        const before = run(rule, slot, busy, now).kind;
        // The extra block goes first and last: order must not matter.
        for (const list of [
          [extra, ...busy],
          [...busy, extra],
        ]) {
          const after = run(rule, slot, list, now).kind;
          if (before !== "accept") expect(after).not.toBe("accept");
        }
      }),
    );
  });

  it("the busy scenarios really do turn accepts into calendar conflicts (so the property bites)", () => {
    const flips = fc
      .sample(calendarScenarioArb, { numRuns: 3000, seed: 2 })
      .filter(({ scenario: { rule, spec, now }, busy, extra }) => {
        const slot = toSlot(spec, "Z");
        return (
          run(rule, slot, busy, now).kind === "accept" &&
          run(rule, slot, [...busy, extra], now).kind !== "accept"
        );
      }).length;
    expect(flips).toBeGreaterThan(100);
  });

  it("adding a window never turns accept into anything else", () => {
    fc.assert(
      fc.property(
        scenarioArb.chain((sc) =>
          fc.tuple(fc.constant(sc), fc.oneof(windowArb, nearWindow(sc.spec))),
        ),
        busyListArb,
        ([{ rule, spec, now }, extra], busy) => {
          const slot = toSlot(spec, "+01:00");
          const wider = AcceptanceRule.parse({ ...rule, windows: [...rule.windows, extra] });
          if (run(rule, slot, busy, now).kind === "accept") {
            expect(run(wider, slot, busy, now).kind).toBe("accept");
          }
        },
      ),
    );
  });

  it("the window property sees plenty of accepts", () => {
    const accepts = fc
      .sample(fc.tuple(scenarioArb, busyListArb), { numRuns: 1000, seed: 3 })
      .filter(
        ([{ rule, spec, now }, busy]) =>
          run(rule, toSlot(spec, "+01:00"), busy, now).kind === "accept",
      ).length;
    expect(accepts).toBeGreaterThan(100);
  });

  it("a slot inside an absolute window, with no other constraint, is accepted", () => {
    fc.assert(
      fc.property(
        instantArb,
        fc.integer({ min: 0, max: 600 }),
        fc.integer({ min: 1, max: 600 }),
        fc.integer({ min: 0, max: 600 }),
        fc.constantFrom(...OFFSETS),
        (windowStart, lead, length, tail, offset) => {
          const start = windowStart.add({ minutes: lead });
          const end = start.add({ minutes: length });
          const rule = AcceptanceRule.parse({
            windows: [
              {
                kind: "absolute",
                start: write(windowStart, "Z"),
                end: write(end.add({ minutes: tail }), "+01:00"),
              },
            ],
            avoidCalendarConflicts: false,
            preference: "earliest",
          });
          const slot = { start: write(start, offset), end: write(end, offset) };
          expect(run(rule, slot, [], windowStart.subtract({ hours: 1 })).kind).toBe("accept");
        },
      ),
    );
  });

  it("is total: never throws, whatever the slot and calendar strings", () => {
    const junk = fc.oneof(
      fc.string(),
      fc.constantFrom(
        "2026-10-05T09:00:00",
        "2026-02-30T09:00:00Z",
        "2026-10-05T09:00:00.1234567890Z",
        "",
      ),
    );
    fc.assert(
      fc.property(
        ruleArb,
        fc.record({ start: junk, end: fc.option(junk, { nil: undefined }) }),
        fc.array(fc.record({ start: junk, end: junk }), { maxLength: 3 }),
        nowArb,
        fc.record(
          {
            heard: fc.record(
              {
                weekday: fc.constantFrom(...WEEKDAYS),
                dayOfMonth: fc.integer({ min: -5, max: 99 }),
                month: fc.integer({ min: -1, max: 20 }),
              },
              { requiredKeys: [] },
            ),
            existingAppointment: fc.record({
              startsAt: junk,
              endsAt: fc.option(junk, { nil: undefined }),
            }),
            defaultDurationMinutes: fc.oneof(fc.double(), fc.integer({ min: -10, max: 2000 })),
          },
          { requiredKeys: [] },
        ),
        (rule, raw, busy, now, extraCtx) => {
          const slot: Slot =
            raw.end === undefined ? { start: raw.start } : { start: raw.start, end: raw.end };
          const { existingAppointment, ...rest } = extraCtx;
          const ctx = {
            now,
            timezone: TZ,
            ...rest,
            ...(existingAppointment === undefined
              ? {}
              : {
                  existingAppointment:
                    existingAppointment.endsAt === undefined
                      ? { startsAt: existingAppointment.startsAt }
                      : {
                          startsAt: existingAppointment.startsAt,
                          endsAt: existingAppointment.endsAt,
                        },
                }),
          };
          const result = evaluateAcceptance(rule, slot, busy, ctx);
          expect(["accept", "reject", "outside_rule"]).toContain(result.kind);
        },
      ),
    );
  });

  it("an accepted slot is never in the past, and reject never carries a slot", () => {
    fc.assert(
      fc.property(scenarioArb, busyListArb, ({ rule, spec, now }, busy) => {
        const result = run(rule, toSlot(spec, "Z"), busy, now);
        if (result.kind === "accept") {
          expect(
            Temporal.Instant.compare(Temporal.Instant.from(result.slot.start), now),
          ).toBeGreaterThanOrEqual(0);
        }
        if (result.kind === "reject") expect("slot" in result).toBe(false);
      }),
    );
  });
});
