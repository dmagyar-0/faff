import { describe, expect, it } from "vitest";

import { Limits } from "./brief";
import {
  callBudget,
  DEFAULT_OPENING_HOURS,
  type DialContext,
  type DialRecord,
  isOpenAt,
  mayDial,
  nextOpenAt,
  nextRedialAt,
  planRedial,
  remaining,
} from "./limits";
import { BANK_HOLIDAYS_EW } from "./locale/en-GB";
import type { OpeningPeriod } from "./observations";
import { Temporal } from "./time";

const TZ = "Europe/London" as const;
const at = (iso: string) => Temporal.Instant.from(iso);
const iso = (i: Temporal.Instant | undefined) => i?.toString();
const DEFAULTS = Limits.parse({});

// Tue 13 Oct 2026, BST (UTC+1): 10:00 local is 09:00Z.
const TUE_10 = "2026-10-13T09:00:00Z";

const ctx = (over: Partial<DialContext> = {}): DialContext => ({
  limits: DEFAULTS,
  usage: { attemptsUsed: 0, callSecondsUsed: 0 },
  dispatchedAt: at("2026-10-12T08:00:00Z"),
  now: at(TUE_10),
  timezone: TZ,
  holidays: BANK_HOLIDAYS_EW,
  history: [],
  ...over,
});
const dial = (endedAt: string, extra: Partial<DialRecord> = {}): DialRecord => ({
  endedAt: at(endedAt),
  humanAnswered: false,
  heardClosed: false,
  ...extra,
});

describe("remaining", () => {
  it("counts down each limit from the Brief's defaults", () => {
    const left = remaining(
      DEFAULTS,
      { attemptsUsed: 1, callSecondsUsed: 125 },
      at("2026-10-12T08:00:00Z"),
      at("2026-10-12T09:00:00Z"),
    );
    expect(left).toEqual({
      dials: 2,
      callSeconds: 30 * 60 - 125,
      lifetimeUntil: at("2026-10-19T08:00:00Z"),
      lifetimeSeconds: 6 * 24 * 3600 + 23 * 3600,
    });
  });

  it("counts a lifetime day as 24 hours across a clock change", () => {
    // Dispatched Fri 23 Oct 10:00 BST; clocks go back on Sun 25 Oct. P7D is 168 hours later,
    // which is 09:00 GMT on the local clock.
    const left = remaining(
      DEFAULTS,
      { attemptsUsed: 0, callSecondsUsed: 0 },
      at("2026-10-23T09:00:00Z"),
      at("2026-10-23T09:00:00Z"),
    );
    expect(iso(left.lifetimeUntil)).toBe("2026-10-30T09:00:00Z");
  });

  it("never goes negative, and reads a nonsense counter as zero", () => {
    const left = remaining(
      Limits.parse({ maxLifetime: "PT1H" }),
      { attemptsUsed: 9, callSecondsUsed: 99_999 },
      at("2026-10-12T08:00:00Z"),
      at("2026-10-13T08:00:00Z"),
    );
    expect([left.dials, left.callSeconds, left.lifetimeSeconds]).toEqual([0, 0, 0]);
    const odd = remaining(
      DEFAULTS,
      { attemptsUsed: Number.NaN, callSecondsUsed: -5 },
      at("2026-10-12T08:00:00Z"),
      at("2026-10-12T08:00:00Z"),
    );
    expect([odd.dials, odd.callSeconds]).toEqual([3, 1800]);
  });

  it("treats an unreadable lifetime as none left", () => {
    const limits = { ...DEFAULTS, maxLifetime: "P1W" };
    expect(
      remaining(limits, { attemptsUsed: 0, callSecondsUsed: 0 }, at(TUE_10), at(TUE_10))
        .lifetimeSeconds,
    ).toBe(0);
  });
});

describe("mayDial: limits", () => {
  it("is ok inside opening hours with limits to spare", () => {
    expect(mayDial(ctx())).toEqual({ kind: "ok" });
  });

  it("is exhausted when the attempts are used up", () => {
    expect(mayDial(ctx({ usage: { attemptsUsed: 3, callSecondsUsed: 0 } }))).toEqual({
      kind: "exhausted",
      which: "attempts",
    });
  });

  it("needs a minute of call time: enough for the disclosure and a close (I-4)", () => {
    const at1740 = mayDial(ctx({ usage: { attemptsUsed: 1, callSecondsUsed: 1740 } }));
    expect(at1740).toEqual({ kind: "ok" });
    const at1741 = mayDial(ctx({ usage: { attemptsUsed: 1, callSecondsUsed: 1741 } }));
    expect(at1741).toEqual({ kind: "exhausted", which: "minutes" });
  });

  it("is exhausted at the lifetime's end, not a moment after", () => {
    const limits = Limits.parse({ maxLifetime: "PT1H" });
    const verdict = mayDial(ctx({ limits, dispatchedAt: at("2026-10-13T08:00:00Z") }));
    expect(verdict).toEqual({ kind: "exhausted", which: "lifetime" });
    const before = mayDial(ctx({ limits, dispatchedAt: at("2026-10-13T08:00:00.001Z") }));
    expect(before).toEqual({ kind: "ok" });
  });

  it("reports attempts before minutes before lifetime", () => {
    const all = ctx({
      limits: Limits.parse({ maxLifetime: "PT1H" }),
      usage: { attemptsUsed: 3, callSecondsUsed: 1800 },
      dispatchedAt: at("2026-10-01T00:00:00Z"),
    });
    expect(mayDial(all)).toEqual({ kind: "exhausted", which: "attempts" });
    expect(mayDial({ ...all, usage: { attemptsUsed: 0, callSecondsUsed: 1800 } })).toEqual({
      kind: "exhausted",
      which: "minutes",
    });
  });

  it("is exhausted when the next opening comes after the lifetime ends", () => {
    // Fri 16 Oct 18:00 BST, lifetime ends Sat noon: nothing opens before Monday.
    const verdict = mayDial(
      ctx({
        limits: Limits.parse({ maxLifetime: "P1D" }),
        dispatchedAt: at("2026-10-16T11:00:00Z"),
        now: at("2026-10-16T17:00:00Z"),
      }),
    );
    expect(verdict).toEqual({ kind: "exhausted", which: "lifetime" });
  });
});

describe("mayDial: opening hours (fallback Mon–Fri 09:00–17:30)", () => {
  const wait = (now: string, over: Partial<DialContext> = {}) => {
    const v = mayDial(ctx({ now: at(now), dispatchedAt: at(now), ...over }));
    return v.kind === "not_before" ? [iso(v.at), v.reason] : v;
  };

  it("waits for 09:00 before opening", () => {
    expect(wait("2026-10-13T07:30:00Z")).toEqual(["2026-10-13T08:00:00Z", "closed"]);
  });

  it("opens at 09:00 exactly and closes at 17:30 exactly", () => {
    expect(mayDial(ctx({ now: at("2026-10-13T08:00:00Z") }))).toEqual({ kind: "ok" });
    expect(mayDial(ctx({ now: at("2026-10-13T16:29:59Z") }))).toEqual({ kind: "ok" });
    expect(wait("2026-10-13T16:30:00Z")).toEqual(["2026-10-14T08:00:00Z", "closed"]);
  });

  it("skips the weekend", () => {
    expect(wait("2026-10-16T16:45:00Z")).toEqual(["2026-10-19T08:00:00Z", "closed"]);
    expect(wait("2026-10-17T10:00:00Z")).toEqual(["2026-10-19T08:00:00Z", "closed"]);
  });

  it("skips bank holidays: Easter and Christmas 2026", () => {
    // Thu 2 Apr 18:00 BST → Good Friday, the weekend and Easter Monday are closed.
    expect(wait("2026-04-02T17:00:00Z")).toEqual(["2026-04-07T08:00:00Z", "closed"]);
    // Thu 24 Dec 18:00 GMT → Christmas Day, the weekend, and the substitute day on the 28th.
    expect(wait("2026-12-24T18:00:00Z")).toEqual(["2026-12-29T09:00:00Z", "closed"]);
  });

  it("uses the local clock on both sides of a clock change", () => {
    // Fri 23 Oct 17:45 BST → Mon 26 Oct 09:00 GMT, which is 09:00Z.
    expect(wait("2026-10-23T16:45:00Z")).toEqual(["2026-10-26T09:00:00Z", "closed"]);
    // Fri 27 Mar 17:45 GMT → Mon 30 Mar 09:00 BST, which is 08:00Z.
    expect(wait("2026-03-27T17:45:00Z")).toEqual(["2026-03-30T08:00:00Z", "closed"]);
  });

  it("waits 5 minutes after a call a human answered (I-4)", () => {
    const history = [dial("2026-10-13T08:58:00Z", { humanAnswered: true })];
    expect(wait(TUE_10, { history })).toEqual(["2026-10-13T09:03:00Z", "human_answered_recently"]);
    expect(mayDial(ctx({ history, now: at("2026-10-13T09:03:00Z") }))).toEqual({ kind: "ok" });
  });

  it("doesn't wait after a call no human answered", () => {
    expect(mayDial(ctx({ history: [dial("2026-10-13T08:59:00Z")] }))).toEqual({ kind: "ok" });
  });

  it("goes by the latest human-answered call, in any order", () => {
    const history = [
      dial("2026-10-13T08:58:00Z", { humanAnswered: true }),
      dial("2026-10-13T08:40:00Z", { humanAnswered: true }),
    ];
    expect(wait(TUE_10, { history })).toEqual(["2026-10-13T09:03:00Z", "human_answered_recently"]);
  });

  it("says closed when the gap runs past closing time", () => {
    const history = [dial("2026-10-13T16:27:00Z", { humanAnswered: true })];
    expect(wait("2026-10-13T16:28:00Z", { history })).toEqual(["2026-10-14T08:00:00Z", "closed"]);
  });
});

describe("opening hours from observations", () => {
  const SAT_MORNINGS: OpeningPeriod[] = [{ day: "sat", from: "10:00", to: "13:00" }];

  it("replaces the fallback entirely", () => {
    expect(isOpenAt(at(TUE_10), SAT_MORNINGS, TZ, [])).toBe(false);
    expect(iso(nextOpenAt(at(TUE_10), SAT_MORNINGS, TZ, []))).toBe("2026-10-17T09:00:00Z");
  });

  it("falls back when the observation lists nothing, or only empty periods", () => {
    expect(isOpenAt(at(TUE_10), [], TZ, [])).toBe(true);
    expect(isOpenAt(at(TUE_10), undefined, TZ, [])).toBe(true);
    expect(isOpenAt(at(TUE_10), [{ day: "tue", from: "12:00", to: "12:00" }], TZ, [])).toBe(true);
  });

  it("runs a period past midnight from the day it starts", () => {
    const lateFri: OpeningPeriod[] = [{ day: "fri", from: "22:00", to: "02:00" }];
    // Sat 17 Oct 01:30 BST is inside Friday's period.
    expect(isOpenAt(at("2026-10-17T00:30:00Z"), lateFri, TZ, [])).toBe(true);
    expect(isOpenAt(at("2026-10-17T01:00:00Z"), lateFri, TZ, [])).toBe(false);
  });

  it("closes a period on a bank holiday even when the business keeps other hours", () => {
    const mondays: OpeningPeriod[] = [{ day: "mon", from: "09:00", to: "12:00" }];
    // From Sat 29 Aug 2026 the next Monday, 31 Aug, is a bank holiday: Mon 7 Sep instead.
    expect(iso(nextOpenAt(at("2026-08-29T09:00:00Z"), mondays, TZ, BANK_HOLIDAYS_EW))).toBe(
      "2026-09-07T08:00:00Z",
    );
  });

  it("merges adjacent periods into one window", () => {
    const split: OpeningPeriod[] = [
      { day: "tue", from: "09:00", to: "12:00" },
      { day: "tue", from: "12:00", to: "17:00" },
    ];
    expect(isOpenAt(at("2026-10-13T11:00:00Z"), split, TZ, [])).toBe(true);
    // An IVR "closed" at 12:30 moves to the next window's start: Tuesday next week, not 12:00.
    const next = nextRedialAt({
      now: at("2026-10-13T11:30:00Z"),
      timezone: TZ,
      holidays: [],
      openingHours: split,
      history: [dial("2026-10-13T11:30:00Z", { heardClosed: true })],
    });
    expect(iso(next)).toBe("2026-10-20T08:00:00Z");
  });

  it("moves a period's missing edges forward on the spring-forward night", () => {
    // 01:15 and 01:45 don't exist on Sun 29 Mar 2026: they resolve to 02:15 and 02:45 BST.
    const inGap: OpeningPeriod[] = [{ day: "sun", from: "01:15", to: "01:45" }];
    expect(iso(nextOpenAt(at("2026-03-28T12:00:00Z"), inGap, TZ, []))).toBe("2026-03-29T01:15:00Z");
  });

  it("drops a period the spring-forward gap swallows", () => {
    // 01:15 resolves to 02:15 BST, the same instant as 02:15: empty, so next Sunday.
    const swallowed: OpeningPeriod[] = [{ day: "sun", from: "01:15", to: "02:15" }];
    expect(iso(nextOpenAt(at("2026-03-28T12:00:00Z"), swallowed, TZ, []))).toBe(
      "2026-04-05T00:15:00Z",
    );
  });

  it("keeps both passes of the repeated hour on the fall-back night", () => {
    // 01:00–02:00 on Sun 25 Oct 2026 starts at the first 01:00 (BST) and ends at 02:00 GMT.
    const night: OpeningPeriod[] = [{ day: "sun", from: "01:00", to: "02:00" }];
    expect(isOpenAt(at("2026-10-25T00:00:00Z"), night, TZ, [])).toBe(true);
    expect(isOpenAt(at("2026-10-25T01:30:00Z"), night, TZ, [])).toBe(true);
    expect(isOpenAt(at("2026-10-25T02:00:00Z"), night, TZ, [])).toBe(false);
  });

  it("finds nothing when every day ahead is a holiday", () => {
    const start = Temporal.PlainDate.from("2026-10-12");
    const all = Array.from({ length: 40 }, (_, i) => start.add({ days: i }).toString());
    expect(nextOpenAt(at(TUE_10), DEFAULT_OPENING_HOURS, TZ, all)).toBeUndefined();
    expect(isOpenAt(at(TUE_10), undefined, TZ, all)).toBe(false);
    expect(mayDial(ctx({ holidays: all }))).toEqual({ kind: "exhausted", which: "lifetime" });
  });
});

describe("nextRedialAt", () => {
  const base = { timezone: TZ, holidays: BANK_HOLIDAYS_EW, openingHours: undefined } as const;

  it("waits 20 minutes after the first attempt, then 2 hours after each later one", () => {
    const first = [dial("2026-10-13T09:00:00Z")];
    expect(iso(nextRedialAt({ ...base, now: at(TUE_10), history: first }))).toBe(
      "2026-10-13T09:20:00Z",
    );
    const second = [...first, dial("2026-10-13T09:25:00Z")];
    expect(iso(nextRedialAt({ ...base, now: at("2026-10-13T09:25:00Z"), history: second }))).toBe(
      "2026-10-13T11:25:00Z",
    );
    const third = [...second, dial("2026-10-13T11:30:00Z")];
    expect(iso(nextRedialAt({ ...base, now: at("2026-10-13T11:30:00Z"), history: third }))).toBe(
      "2026-10-13T13:30:00Z",
    );
  });

  it("moves the redial into the next opening window", () => {
    // Fri 16 Oct 17:15 BST + 20 min is after closing: Monday 09:00.
    const history = [dial("2026-10-16T16:15:00Z")];
    expect(iso(nextRedialAt({ ...base, now: at("2026-10-16T16:15:00Z"), history }))).toBe(
      "2026-10-19T08:00:00Z",
    );
  });

  it("after an IVR says closed, goes to the start of the next window", () => {
    // Tue 07:30 BST, before opening: today at 09:00.
    const early = [dial("2026-10-13T06:30:00Z", { heardClosed: true })];
    expect(iso(nextRedialAt({ ...base, now: at("2026-10-13T06:30:00Z"), history: early }))).toBe(
      "2026-10-13T08:00:00Z",
    );
    // Tue 13:00 BST, when the fallback hours thought it open: those hours were wrong today.
    const midday = [dial("2026-10-13T12:00:00Z", { heardClosed: true })];
    expect(iso(nextRedialAt({ ...base, now: at("2026-10-13T12:00:00Z"), history: midday }))).toBe(
      "2026-10-14T08:00:00Z",
    );
  });

  it("takes the later due time when two calls end at the same instant", () => {
    const history = [
      dial("2026-10-13T12:00:00Z"),
      dial("2026-10-13T12:00:00Z", { heardClosed: true }),
    ];
    const now = at("2026-10-13T12:00:00Z");
    expect(iso(nextRedialAt({ ...base, now, history }))).toBe("2026-10-14T08:00:00Z");
    const reversed = [...history].reverse();
    expect(iso(nextRedialAt({ ...base, now, history: reversed }))).toBe("2026-10-14T08:00:00Z");
  });

  it("is never before now", () => {
    const history = [dial("2026-10-13T08:00:00Z")];
    expect(iso(nextRedialAt({ ...base, now: at("2026-10-13T10:00:00Z"), history }))).toBe(
      "2026-10-13T10:00:00Z",
    );
  });

  it("dials straight away, in hours, with no history", () => {
    expect(iso(nextRedialAt({ ...base, now: at(TUE_10), history: [] }))).toBe(TUE_10);
  });

  it("keeps the 5-minute gap when a person says they're about to open", () => {
    // Tue 09:58 BST a receptionist answers: "we open at ten, call back then". The next window
    // (fallback 09:00–17:30) is already open, so the redial waits only for the gap.
    const history = [dial("2026-10-13T08:58:00Z", { humanAnswered: true })];
    expect(iso(nextRedialAt({ ...base, now: at("2026-10-13T08:58:00Z"), history }))).toBe(
      "2026-10-13T09:18:00Z",
    );
    // Observed hours open at 10:00: a closed message at 09:58 would allow 10:00, but the gap
    // after a human answer pushes it to 10:03.
    const tenAm: OpeningPeriod[] = [{ day: "tue", from: "10:00", to: "17:00" }];
    const closedByPerson = [
      dial("2026-10-13T08:58:00Z", { humanAnswered: true, heardClosed: true }),
    ];
    const next = nextRedialAt({
      ...base,
      openingHours: tenAm,
      now: at("2026-10-13T08:58:00Z"),
      history: closedByPerson,
    });
    expect(iso(next)).toBe("2026-10-13T09:03:00Z");
  });

  it("is undefined when nothing opens, including after a closed message", () => {
    const start = Temporal.PlainDate.from("2026-10-12");
    const all = Array.from({ length: 40 }, (_, i) => start.add({ days: i }).toString());
    const closed = [dial("2026-10-13T12:00:00Z", { heardClosed: true })];
    expect(
      nextRedialAt({ ...base, holidays: all, now: at(TUE_10), history: closed }),
    ).toBeUndefined();
    expect(nextRedialAt({ ...base, holidays: all, now: at(TUE_10), history: [] })).toBeUndefined();
  });
});

describe("planRedial", () => {
  it("plans the redial when limits remain", () => {
    const plan = planRedial(
      ctx({ usage: { attemptsUsed: 1, callSecondsUsed: 0 }, history: [dial(TUE_10)] }),
    );
    expect(plan.kind === "redial" && iso(plan.at)).toBe("2026-10-13T09:20:00Z");
  });

  it("escalates when the last attempt is used", () => {
    const history = [dial("2026-10-13T06:00:00Z"), dial("2026-10-13T08:00:00Z"), dial(TUE_10)];
    expect(planRedial(ctx({ usage: { attemptsUsed: 3, callSecondsUsed: 0 }, history }))).toEqual({
      kind: "exhausted",
      which: "attempts",
    });
  });

  it("escalates when the redial would land after the lifetime", () => {
    // Dispatched Tue 08:00 BST with a 3-hour lifetime; a 2-hour backoff from 10:00 is too late.
    const verdict = planRedial(
      ctx({
        limits: Limits.parse({ maxLifetime: "PT3H" }),
        dispatchedAt: at("2026-10-13T07:00:00Z"),
        usage: { attemptsUsed: 2, callSecondsUsed: 0 },
        history: [dial("2026-10-13T08:00:00Z"), dial(TUE_10)],
      }),
    );
    expect(verdict).toEqual({ kind: "exhausted", which: "lifetime" });
  });

  it("escalates when nothing opens again", () => {
    const start = Temporal.PlainDate.from("2026-10-12");
    const all = Array.from({ length: 40 }, (_, i) => start.add({ days: i }).toString());
    expect(planRedial(ctx({ holidays: all, history: [dial(TUE_10)] }))).toEqual({
      kind: "exhausted",
      which: "lifetime",
    });
  });
});

describe("callBudget", () => {
  it("closes a minute before the limit and stops at it", () => {
    expect(callBudget(1800)).toEqual({ closeAfterSeconds: 1740, hardStopAfterSeconds: 1800 });
  });

  it("closes at once with a minute or less left", () => {
    expect(callBudget(60)).toEqual({ closeAfterSeconds: 0, hardStopAfterSeconds: 60 });
    expect(callBudget(30)).toEqual({ closeAfterSeconds: 0, hardStopAfterSeconds: 30 });
  });

  it("rounds down and never goes negative", () => {
    expect(callBudget(90.9)).toEqual({ closeAfterSeconds: 30, hardStopAfterSeconds: 90 });
    expect(callBudget(-5)).toEqual({ closeAfterSeconds: 0, hardStopAfterSeconds: 0 });
    expect(callBudget(Number.NaN)).toEqual({ closeAfterSeconds: 0, hardStopAfterSeconds: 0 });
  });
});
