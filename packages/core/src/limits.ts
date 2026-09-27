/**
 * Per-task limits (I-8, Q27) and the redial rules (I-4, spec 03). The worker asks `mayDial` before
 * every dial, `planRedial` after every call that ends without contact, and `callBudget` for the
 * watchdog and the provider's `maxDurationSec`. Nothing here reads the clock: `now` is an argument.
 *
 * Opening hours are the business's observed weekly hours, else Mon–Fri 09:00–17:30, in the
 * Brief's timezone. Bank holidays are closed either way: the caller passes the locale's list
 * (en-GB: England & Wales), the same one `working-days.ts` uses.
 */
import type { Brief, Limits } from "./brief";
import type { OpeningPeriod } from "./observations";
import { durationSeconds, WEEKDAYS } from "./primitives";
import {
  compareDates,
  compareInstants,
  type Instant,
  isoWeekday,
  localDateOf,
  type PlainDate,
  wallClockInstant,
} from "./time";
import type { Holidays } from "./working-days";

/** Used when no business hours have been observed (spec 03). */
export const DEFAULT_OPENING_HOURS: readonly OpeningPeriod[] = (
  ["mon", "tue", "wed", "thu", "fri"] as const
).map((day) => ({ day, from: "09:00", to: "17:30" }));

/** Backoff after the first unanswered attempt, then after every later one (spec 03). */
export const FIRST_REDIAL_MINUTES = 20;
export const LATER_REDIAL_MINUTES = 120;
/** No dial within this long after a call a human answered (I-4, Ofcom abandonment pattern). */
export const HUMAN_ANSWERED_GAP_MINUTES = 5;
/**
 * The watchdog starts the graceful close this long before the minute limit. It is also the least
 * call time a dial needs: with less, the agent couldn't give the disclosure line and a close
 * before the hard stop, and I-4 says it never hangs up on a live human without speaking.
 */
export const CLOSE_LEAD_SECONDS = 60;
/**
 * How far ahead to look for an opening window: longer than the longest lifetime (P30D), so a
 * window that isn't found is one the task could never have used.
 */
export const OPENING_SEARCH_DAYS = 35;

export const LIMIT_KINDS = ["attempts", "minutes", "lifetime"] as const;
export type LimitKind = (typeof LIMIT_KINDS)[number];

/** Why a dial has to wait. */
export const WAIT_REASONS = ["closed", "human_answered_recently", "backoff"] as const;
export type WaitReason = (typeof WAIT_REASONS)[number];

/** The task's counters (`tasks.attempts_used`, `tasks.call_seconds_used`), across revisions (G3). */
export type Usage = { readonly attemptsUsed: number; readonly callSecondsUsed: number };

/** One dial already made on this task, as the redial rules need it. */
export type DialRecord = {
  readonly endedAt: Instant;
  /** A person picked up (not voicemail, not only an IVR). Starts the 5-minute gap (I-4). */
  readonly humanAnswered: boolean;
  /** An IVR or recording said the business is closed: the redial goes to the next window. */
  readonly heardClosed: boolean;
};

export type Remaining = {
  readonly dials: number;
  /** Talk plus hold seconds left, across every call. */
  readonly callSeconds: number;
  readonly lifetimeUntil: Instant;
  /** Whole seconds from `now` to `lifetimeUntil`, never negative. */
  readonly lifetimeSeconds: number;
};

export type DialContext = {
  readonly limits: Limits;
  readonly usage: Usage;
  /** When the lifetime started: dispatch, or approval for a cancel awaiting confirmation (G15). */
  readonly dispatchedAt: Instant;
  readonly now: Instant;
  readonly timezone: Brief["timezone"];
  /** Observed weekly hours (`deriveBusinessProfile`), if any. Empty means none observed. */
  readonly openingHours?: readonly OpeningPeriod[] | undefined;
  /** The locale's bank holidays, `YYYY-MM-DD`. */
  readonly holidays: Holidays;
  /** Every dial made on this task so far, in any order. */
  readonly history: readonly DialRecord[];
  /**
   * The redial time `planRedial` scheduled, if this dial is a redial. `mayDial` holds to it, so a
   * timer that fires early or twice can't cut the backoff short.
   */
  readonly notBefore?: Instant | undefined;
};

export type DialVerdict =
  | { readonly kind: "ok" }
  | { readonly kind: "not_before"; readonly at: Instant; readonly reason: WaitReason }
  | { readonly kind: "exhausted"; readonly which: LimitKind };

export type RedialPlan =
  | { readonly kind: "redial"; readonly at: Instant }
  | { readonly kind: "exhausted"; readonly which: LimitKind };

export type CallBudget = {
  /** Seconds into the call's counted time (talk plus hold) when the watchdog starts closing. */
  readonly closeAfterSeconds: number;
  /** The hard stop, and the provider's `maxDurationSec`: the limit itself, not above it. */
  readonly hardStopAfterSeconds: number;
};

type Interval = { readonly start: Instant; readonly end: Instant };

const later = (a: Instant, b: Instant): Instant => (compareInstants(a, b) >= 0 ? a : b);

/**
 * A usage counter as whole units, rounded up: 1740.5 seconds used leaves 59 of 1800, not 60.
 * A counter that isn't a finite, non-negative number can't be trusted, so it uses everything up.
 */
const used = (n: number): number => (Number.isFinite(n) && n >= 0 ? Math.ceil(n) : Infinity);

/** Whole seconds, rounded down, never negative. */
const wholeSeconds = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

/**
 * What is left of each limit. A lifetime day is 24 hours of elapsed time, so a lifetime that
 * crosses a clock change is neither stretched nor shrunk. The Brief parser has checked
 * `maxLifetime`; an unreadable one counts as no lifetime at all.
 */
export const remaining = (
  limits: Limits,
  usage: Usage,
  dispatchedAt: Instant,
  now: Instant,
): Remaining => {
  const lifetimeUntil = dispatchedAt.add({ seconds: durationSeconds(limits.maxLifetime) ?? 0 });
  return {
    dials: Math.max(0, limits.maxDialAttempts - used(usage.attemptsUsed)),
    callSeconds: Math.max(0, limits.maxCallMinutes * 60 - used(usage.callSecondsUsed)),
    lifetimeUntil,
    lifetimeSeconds: Math.max(0, Math.floor(lifetimeUntil.since(now).total({ unit: "seconds" }))),
  };
};

/** The first limit that rules out another dial at `now`, if any. */
const exhaustedLimit = (left: Remaining, now: Instant): LimitKind | undefined => {
  if (left.dials === 0) return "attempts";
  if (left.callSeconds < CLOSE_LEAD_SECONDS) return "minutes";
  if (compareInstants(now, left.lifetimeUntil) >= 0) return "lifetime";
  return undefined;
};

/** Periods that name some time: `from === to` says nothing, so it is dropped. */
const usablePeriods = (hours: readonly OpeningPeriod[] | undefined): readonly OpeningPeriod[] => {
  const periods = (hours ?? []).filter((p) => p.from !== p.to);
  return periods.length > 0 ? periods : DEFAULT_OPENING_HOURS;
};

/**
 * Every opening window from the day before `from` for `days` days, merged where they touch or
 * overlap. A period with `from > to` runs past midnight and belongs to the day it starts on; a
 * bank holiday closes the periods that start on it. The last window may be cut short where the
 * range ends, and one that was already open the day before starts there instead; both edges are
 * outside what callers ask about (a window containing `at`, or one starting after it).
 */
const openingWindows = (
  from: Instant,
  days: number,
  hours: readonly OpeningPeriod[] | undefined,
  timezone: string,
  holidays: Holidays,
): Interval[] => {
  const periods = usablePeriods(hours);
  const closed = new Set(holidays);
  const first: PlainDate = localDateOf(from, timezone).subtract({ days: 1 });
  const last = first.add({ days: days + 1 });
  const occurrences: Interval[] = [];
  for (let day = first; compareDates(day, last) <= 0; day = day.add({ days: 1 })) {
    if (closed.has(day.toString())) continue;
    const weekday = WEEKDAYS[isoWeekday(day) - 1];
    for (const p of periods) {
      if (p.day !== weekday) continue;
      const start = wallClockInstant(day, p.from, timezone);
      const end = wallClockInstant(p.from > p.to ? day.add({ days: 1 }) : day, p.to, timezone);
      // A DST gap can swallow a short period whole; an empty one opens nothing.
      if (compareInstants(start, end) < 0) occurrences.push({ start, end });
    }
  }
  occurrences.sort((a, b) => compareInstants(a.start, b.start));
  const merged: Interval[] = [];
  for (const next of occurrences) {
    const prev = merged.at(-1);
    if (prev !== undefined && compareInstants(next.start, prev.end) <= 0) {
      merged[merged.length - 1] = { start: prev.start, end: later(prev.end, next.end) };
    } else {
      merged.push(next);
    }
  }
  return merged;
};

/**
 * The first window from `at` that `matches`. A week ahead answers almost every question, so that
 * is tried before the full `OPENING_SEARCH_DAYS`. A window cut short at the end of the week can't
 * change the answer: `matches` only asks about windows that start in range or contain `at`.
 */
const findWindow = (
  at: Instant,
  hours: readonly OpeningPeriod[] | undefined,
  timezone: string,
  holidays: Holidays,
  matches: (w: Interval) => boolean,
): Interval | undefined =>
  openingWindows(at, 7, hours, timezone, holidays).find(matches) ??
  openingWindows(at, OPENING_SEARCH_DAYS, hours, timezone, holidays).find(matches);

/**
 * The earliest instant at or after `at` when the business is open: `at` itself if it is open
 * then. Windows are half-open, so the closing minute is closed. `undefined` if nothing opens
 * within `OPENING_SEARCH_DAYS`.
 */
export const nextOpenAt = (
  at: Instant,
  hours: readonly OpeningPeriod[] | undefined,
  timezone: string,
  holidays: Holidays,
): Instant | undefined => {
  const window = findWindow(at, hours, timezone, holidays, (w) => compareInstants(w.end, at) > 0);
  return window === undefined ? undefined : later(window.start, at);
};

/**
 * The start of the next opening window that begins after `at`. After an IVR said "we're closed",
 * the window `at` falls in (if the hours think it's open) is the one that was wrong.
 */
const nextWindowStartAfter = (
  at: Instant,
  hours: readonly OpeningPeriod[] | undefined,
  timezone: string,
  holidays: Holidays,
): Instant | undefined =>
  findWindow(at, hours, timezone, holidays, (w) => compareInstants(w.start, at) > 0)?.start;

export const isOpenAt = (
  at: Instant,
  hours: readonly OpeningPeriod[] | undefined,
  timezone: string,
  holidays: Holidays,
): boolean => {
  const open = nextOpenAt(at, hours, timezone, holidays);
  return open !== undefined && compareInstants(open, at) === 0;
};

/** The end of the most recent call a human answered, plus the 5-minute gap. */
const humanGapUntil = (history: readonly DialRecord[]): Instant | undefined =>
  history
    .filter((d) => d.humanAnswered)
    .map((d) => d.endedAt.add({ minutes: HUMAN_ANSWERED_GAP_MINUTES }))
    .reduce<Instant | undefined>((a, b) => (a === undefined ? b : later(a, b)), undefined);

/**
 * Whether the worker may dial now (I-8, I-4). Exhausted limits come first, in the order
 * attempts, minutes, lifetime. Otherwise the dial waits for the 5-minute gap after a call a human
 * answered, for `notBefore` (the scheduled redial) if given, and then for the business to be
 * open. If that wait runs to the end of the lifetime, the lifetime is exhausted: a wake after it
 * could only escalate.
 *
 * Without `notBefore` it doesn't apply the redial backoff: a revision approved after an escalation
 * may dial as soon as the other rules allow.
 */
/** What set the wait: closed hours, else the scheduled backoff, else the human-answered gap. */
const waitReason = (open: Instant, earliest: Instant, afterGap: Instant): WaitReason => {
  if (compareInstants(open, earliest) > 0) return "closed";
  return compareInstants(earliest, afterGap) > 0 ? "backoff" : "human_answered_recently";
};

export const mayDial = (ctx: DialContext): DialVerdict => {
  const left = remaining(ctx.limits, ctx.usage, ctx.dispatchedAt, ctx.now);
  const which = exhaustedLimit(left, ctx.now);
  if (which !== undefined) return { kind: "exhausted", which };
  const gap = humanGapUntil(ctx.history);
  const afterGap = gap === undefined ? ctx.now : later(gap, ctx.now);
  const earliest = ctx.notBefore === undefined ? afterGap : later(ctx.notBefore, afterGap);
  const open = nextOpenAt(earliest, ctx.openingHours, ctx.timezone, ctx.holidays);
  if (open === undefined || compareInstants(open, left.lifetimeUntil) >= 0) {
    return { kind: "exhausted", which: "lifetime" };
  }
  if (compareInstants(open, ctx.now) === 0) return { kind: "ok" };
  return {
    kind: "not_before",
    at: open,
    reason: waitReason(open, earliest, afterGap),
  };
};

/**
 * When to redial after the latest call (spec 03): 20 minutes after the first attempt ended, 2
 * hours after each later one, or the start of the next opening window if an IVR said the
 * business was closed (the backoff, if the hours never close). Never within 5 minutes of a call a human answered, never before `now`, and
 * always moved into an opening window. `undefined` if nothing opens within
 * `OPENING_SEARCH_DAYS`. Limits aren't checked here; `planRedial` does both.
 */
export const nextRedialAt = (
  ctx: Omit<DialContext, "limits" | "usage" | "dispatchedAt" | "notBefore">,
): Instant | undefined => {
  const { history, openingHours, timezone, holidays, now } = ctx;
  const backoff = history.length === 1 ? FIRST_REDIAL_MINUTES : LATER_REDIAL_MINUTES;
  const latest = history.filter((d) =>
    history.every((other) => compareInstants(other.endedAt, d.endedAt) <= 0),
  );
  let earliest = now;
  // Two calls can end at the same instant; the later of their due times wins, in any order.
  for (const d of latest) {
    const afterBackoff = d.endedAt.add({ minutes: backoff });
    const due = d.heardClosed
      ? (nextWindowStartAfter(d.endedAt, openingHours, timezone, holidays) ?? afterBackoff)
      : afterBackoff;
    earliest = later(earliest, due);
  }
  const gap = humanGapUntil(history);
  if (gap !== undefined) earliest = later(earliest, gap);
  return nextOpenAt(earliest, openingHours, timezone, holidays);
};

/**
 * What happens after a call that didn't reach an outcome: a redial time, or the limit that stops
 * the task (→ `escalated(limit_reached)`, I-8). `ctx.usage` already counts the call that just
 * ended. At the planned time, `mayDial` with the same inputs and `notBefore` set to it says
 * `ok`.
 */
export const planRedial = (ctx: DialContext): RedialPlan => {
  const left = remaining(ctx.limits, ctx.usage, ctx.dispatchedAt, ctx.now);
  const which = exhaustedLimit(left, ctx.now);
  if (which !== undefined) return { kind: "exhausted", which };
  const at = nextRedialAt(ctx);
  if (at === undefined || compareInstants(at, left.lifetimeUntil) >= 0) {
    return { kind: "exhausted", which: "lifetime" };
  }
  return { kind: "redial", at };
};

/**
 * The watchdog's schedule for one call, given the call seconds left (`remaining().callSeconds`).
 * The graceful close starts `CLOSE_LEAD_SECONDS` before the limit, and the hard stop is the limit
 * itself: the provider's `maxDurationSec` is set to it, never above, so a missed watchdog can't
 * run past the limit (`limits_respected`).
 */
export const callBudget = (remainingSeconds: number): CallBudget => {
  const hardStopAfterSeconds = wholeSeconds(remainingSeconds);
  return {
    closeAfterSeconds: Math.max(0, hardStopAfterSeconds - CLOSE_LEAD_SECONDS),
    hardStopAfterSeconds,
  };
};
