import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { Limits } from "./brief";
import {
  callBudget,
  CLOSE_LEAD_SECONDS,
  type DialContext,
  type DialRecord,
  FIRST_REDIAL_MINUTES,
  HUMAN_ANSWERED_GAP_MINUTES,
  LATER_REDIAL_MINUTES,
  isOpenAt,
  mayDial,
  nextOpenAt,
  nextRedialAt,
  planRedial,
  remaining,
} from "./limits";
import { BANK_HOLIDAYS_EW } from "./locale/en-GB";
import type { OpeningPeriod } from "./observations";
import { WEEKDAYS } from "./primitives";
import { compareInstants, Temporal, type Instant } from "./time";

const TZ = "Europe/London" as const;
const MINUTE = 60_000;
const FROM = Date.UTC(2026, 0, 1);
const TO = Date.UTC(2028, 11, 1);
/** Every Europe/London clock change in range, so the arbitraries can crowd around them. */
const TRANSITIONS = [
  "2026-03-29T01:00:00Z",
  "2026-10-25T01:00:00Z",
  "2027-03-28T01:00:00Z",
  "2027-10-31T01:00:00Z",
  "2028-03-26T01:00:00Z",
  "2028-10-29T01:00:00Z",
].map((iso) => Date.parse(iso));

/** Instants across 2026–2028, a third of them within two days of a DST change. */
const instantArb: fc.Arbitrary<Instant> = fc
  .oneof(
    fc.integer({ min: FROM / MINUTE, max: TO / MINUTE }).map((m) => m * MINUTE),
    fc
      .tuple(fc.constantFrom(...TRANSITIONS), fc.integer({ min: -48 * 60, max: 48 * 60 }))
      .map(([t, m]) => t + m * MINUTE),
    fc.integer({ min: FROM, max: TO }),
  )
  .map((ms) => Temporal.Instant.fromEpochMilliseconds(ms));

const wallTime = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.constantFrom(0, 15, 30, 45, 59))
  .map(([h, m]) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);

/** Observed hours: none (fallback), or up to 6 periods, some crossing midnight or empty. */
const hoursArb: fc.Arbitrary<readonly OpeningPeriod[] | undefined> = fc.option(
  fc.array(fc.record({ day: fc.constantFrom(...WEEKDAYS), from: wallTime, to: wallTime }), {
    maxLength: 6,
  }),
  { nil: undefined },
);

const holidaysArb = fc.oneof(
  fc.constant(BANK_HOLIDAYS_EW),
  fc.subarray([...BANK_HOLIDAYS_EW]),
  fc.constant([] as string[]),
);

const limitsArb: fc.Arbitrary<Limits> = fc
  .record({
    maxDialAttempts: fc.integer({ min: 1, max: 20 }),
    maxCallMinutes: fc.integer({ min: 1, max: 600 }),
    maxLifetime: fc.constantFrom("PT1H", "PT3H", "P1D", "P2D", "P7D", "P1DT12H", "P30D"),
  })
  .map((l) => Limits.parse(l));

/** A dial history ending before `now`: up to 5 calls, in any order. */
const historyArb = (now: Instant): fc.Arbitrary<DialRecord[]> =>
  fc.array(
    fc.record({
      // Some within minutes of now, so the 5-minute gap and the 20-minute backoff come up.
      endedAt: fc
        .oneof(
          fc.integer({ min: 0, max: HUMAN_ANSWERED_GAP_MINUTES }),
          fc.integer({ min: 0, max: 30 }),
          fc.integer({ min: 0, max: 3 * 24 * 60 }),
        )
        .map((m) => now.subtract({ minutes: m })),
      humanAnswered: fc.boolean(),
      heardClosed: fc.boolean(),
    }),
    { maxLength: 5 },
  );

const ctxArb: fc.Arbitrary<DialContext> = instantArb.chain((now) =>
  fc.record({
    limits: limitsArb,
    // Half of each counter fresh, so the cases that aren't exhausted are common enough to test.
    usage: fc.record({
      attemptsUsed: fc.oneof(fc.integer({ min: 0, max: 1 }), fc.integer({ min: 0, max: 21 })),
      callSecondsUsed: fc.oneof(
        fc.integer({ min: 0, max: 600 }),
        fc.integer({ min: 0, max: 600 * 60 + 100 }),
      ),
    }),
    dispatchedAt: fc
      .oneof(fc.integer({ min: 0, max: 120 }), fc.integer({ min: 0, max: 31 * 24 * 60 }))
      .map((m) => now.subtract({ minutes: m })),
    now: fc.constant(now),
    timezone: fc.constant(TZ),
    openingHours: hoursArb,
    holidays: holidaysArb,
    history: historyArb(now),
    notBefore: fc.option(
      fc.integer({ min: -60, max: 180 }).map((m) => now.add({ minutes: m })),
      { nil: undefined },
    ),
  }),
);

const latestHumanEnd = (history: readonly DialRecord[]): Instant | undefined =>
  history
    .filter((d) => d.humanAnswered)
    .map((d) => d.endedAt)
    .sort(compareInstants)
    .at(-1);

describe("limits properties", () => {
  it("a dial is ok only when open, outside the human-answered gap and within every limit", () => {
    fc.assert(
      fc.property(ctxArb, (ctx) => {
        if (mayDial(ctx).kind !== "ok") return;
        const left = remaining(ctx.limits, ctx.usage, ctx.dispatchedAt, ctx.now);
        expect(left.dials).toBeGreaterThan(0);
        expect(left.callSeconds).toBeGreaterThanOrEqual(CLOSE_LEAD_SECONDS);
        expect(compareInstants(ctx.now, left.lifetimeUntil)).toBeLessThan(0);
        expect(isOpenAt(ctx.now, ctx.openingHours, ctx.timezone, ctx.holidays)).toBe(true);
        if (ctx.notBefore !== undefined) {
          expect(compareInstants(ctx.now, ctx.notBefore)).toBeGreaterThanOrEqual(0);
        }
        const human = latestHumanEnd(ctx.history);
        if (human !== undefined) {
          const gapEnd = human.add({ minutes: HUMAN_ANSWERED_GAP_MINUTES });
          expect(compareInstants(ctx.now, gapEnd)).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });

  it("a wait is in the future and before the lifetime ends, and the dial is ok then", () => {
    fc.assert(
      fc.property(ctxArb, (ctx) => {
        const verdict = mayDial(ctx);
        if (verdict.kind !== "not_before") return;
        const left = remaining(ctx.limits, ctx.usage, ctx.dispatchedAt, ctx.now);
        expect(compareInstants(verdict.at, ctx.now)).toBeGreaterThan(0);
        expect(compareInstants(verdict.at, left.lifetimeUntil)).toBeLessThan(0);
        expect(mayDial({ ...ctx, now: verdict.at })).toEqual({ kind: "ok" });
      }),
    );
  });

  it("a planned redial is ok to dial when it comes, and respects the backoff", () => {
    fc.assert(
      fc.property(ctxArb, (ctx) => {
        const plan = planRedial(ctx);
        if (plan.kind !== "redial") return;
        expect(compareInstants(plan.at, ctx.now)).toBeGreaterThanOrEqual(0);
        expect(mayDial({ ...ctx, now: plan.at, notBefore: plan.at })).toEqual({ kind: "ok" });
        const backoff = ctx.history.length === 1 ? FIRST_REDIAL_MINUTES : LATER_REDIAL_MINUTES;
        const lastEnd = ctx.history
          .map((d) => d.endedAt)
          .sort(compareInstants)
          .at(-1);
        for (const d of ctx.history) {
          if (compareInstants(d.endedAt, lastEnd as Instant) !== 0) continue;
          // After "we're closed" the redial is in a later window, so after the call at least.
          const floor = d.heardClosed
            ? d.endedAt.add({ nanoseconds: 1 })
            : d.endedAt.add({ minutes: backoff });
          expect(compareInstants(plan.at, floor)).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });

  it("more usage or a later clock never turns an exhausted task back on", () => {
    fc.assert(
      fc.property(
        ctxArb,
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 3600 }),
        fc.integer({ min: 0, max: 7 * 24 * 60 }),
        (ctx, moreDials, moreSeconds, laterMinutes) => {
          if (mayDial(ctx).kind !== "exhausted") return;
          const worse: DialContext = {
            ...ctx,
            now: ctx.now.add({ minutes: laterMinutes }),
            usage: {
              attemptsUsed: ctx.usage.attemptsUsed + moreDials,
              callSecondsUsed: ctx.usage.callSecondsUsed + moreSeconds,
            },
          };
          expect(mayDial(worse).kind).toBe("exhausted");
          // planRedial makes its own schedule, so it matches mayDial without a `notBefore`.
          if (mayDial({ ...ctx, notBefore: undefined }).kind === "exhausted") {
            expect(planRedial(worse).kind).toBe("exhausted");
          }
        },
      ),
    );
  });

  it("the order of the history doesn't matter", () => {
    fc.assert(
      fc.property(
        ctxArb.chain((ctx) =>
          fc.tuple(
            fc.constant(ctx),
            fc.shuffledSubarray([...ctx.history], { minLength: ctx.history.length }),
          ),
        ),
        ([ctx, shuffled]) => {
          const reversed = { ...ctx, history: [...ctx.history].reverse() };
          expect(mayDial({ ...ctx, history: shuffled })).toEqual(mayDial(ctx));
          expect(nextRedialAt(reversed)?.toString()).toBe(nextRedialAt(ctx)?.toString());
        },
      ),
    );
  });

  it("nextOpenAt is the first open instant: open there, and closed a moment before", () => {
    fc.assert(
      fc.property(instantArb, hoursArb, holidaysArb, (at, hours, holidays) => {
        const open = nextOpenAt(at, hours, TZ, holidays);
        if (open === undefined) return;
        expect(compareInstants(open, at)).toBeGreaterThanOrEqual(0);
        expect(isOpenAt(open, hours, TZ, holidays)).toBe(true);
        if (compareInstants(open, at) > 0) {
          expect(isOpenAt(open.subtract({ nanoseconds: 1 }), hours, TZ, holidays)).toBe(false);
          // Nothing opens earlier: a point halfway there is closed too.
          const mid = Temporal.Instant.fromEpochMilliseconds(
            Math.floor((at.epochMilliseconds + open.epochMilliseconds) / 2),
          );
          expect(isOpenAt(mid, hours, TZ, holidays)).toBe(false);
        }
      }),
    );
  });

  it("with the fallback hours and the E&W holidays, something always opens within a week", () => {
    fc.assert(
      fc.property(instantArb, (at) => {
        const open = nextOpenAt(at, undefined, TZ, BANK_HOLIDAYS_EW);
        expect(open).toBeDefined();
        expect((open as Instant).since(at).total({ unit: "days" })).toBeLessThan(7);
      }),
    );
  });

  it("the call budget closes a minute early and never stops past the limit", () => {
    fc.assert(
      fc.property(fc.double({ min: -100, max: 40_000, noNaN: true }), (seconds) => {
        const b = callBudget(seconds);
        expect(Number.isInteger(b.closeAfterSeconds)).toBe(true);
        expect(Number.isInteger(b.hardStopAfterSeconds)).toBe(true);
        expect(b.hardStopAfterSeconds).toBeLessThanOrEqual(Math.max(0, seconds));
        expect(b.closeAfterSeconds).toBeLessThanOrEqual(b.hardStopAfterSeconds);
        expect(b.closeAfterSeconds).toBeGreaterThanOrEqual(0);
        expect(b.hardStopAfterSeconds - b.closeAfterSeconds).toBeLessThanOrEqual(
          CLOSE_LEAD_SECONDS,
        );
      }),
    );
  });

  it("the generated contexts reach every verdict, so the properties above bite", () => {
    const kinds = new Set<string>();
    fc.assert(
      fc.property(ctxArb, (ctx) => {
        const v = mayDial(ctx);
        kinds.add(
          v.kind === "exhausted"
            ? `exhausted:${v.which}`
            : v.kind === "not_before"
              ? `wait:${v.reason}`
              : v.kind,
        );
        kinds.add(`plan:${planRedial(ctx).kind}`);
      }),
    );
    expect([...kinds].sort()).toEqual([
      "exhausted:attempts",
      "exhausted:lifetime",
      "exhausted:minutes",
      "ok",
      "plan:exhausted",
      "plan:redial",
      "wait:backoff",
      "wait:closed",
      "wait:human_answered_recently",
    ]);
  });
});
