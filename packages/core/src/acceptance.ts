/**
 * `evaluateAcceptance` (I-9, spec 06, M1 plan §3.4): whether an offered slot fits the user's
 * acceptance rule. Deterministic code, not an LLM judgement: `propose_slot` (M4) calls this, and
 * the agent may say yes to the callee only after it returns `accept`.
 *
 * Three answers (G16, M1-Q4):
 * - `accept`: the slot is a real offer and the rule allows it.
 * - `reject`: the slot isn't a real, evaluable offer (unreadable, backwards, in the past, or its
 *   date contradicts what was heard). The agent clarifies; nothing is recorded as an offer.
 * - `outside_rule`: a real offer the rule doesn't allow, with every reason. The agent records it
 *   (`record_offer`) and these become the escalation's offers.
 */
import type { AcceptanceRule, Preference, Window } from "./acceptance-rule";
import type { Brief } from "./brief";
import { type HeardDate, type HeardDateMismatch, heardDateMismatches } from "./heard-date";
import { normalisePractitioner, samePractitioner } from "./practitioner";
import { IsoDateTime, type Slot, WEEKDAYS } from "./primitives";
import {
  addHours,
  addMinutes,
  compareDates,
  compareInstants,
  type Instant,
  isoWeekday,
  localDateOf,
  minutesBetween,
  parseLocalDate,
  type PlainDate,
  toOffsetIso,
  tryInstantOf,
  wallClockInstant,
} from "./time";

/** A slot with no end lasts this long unless the service says otherwise. */
export const DEFAULT_SLOT_MINUTES = 30;
/** Longer than this isn't an appointment slot; it's a misheard or mistyped end. */
export const MAX_SLOT_MINUTES = 24 * 60;

export const REJECT_REASONS = ["invalid_slot", "in_past", "inconsistent_date"] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export const OUTSIDE_RULE_REASONS = [
  "not_in_window",
  "calendar_conflict",
  "calendar_unreadable",
  "too_soon",
  "practitioner_mismatch",
  "practitioner_avoided",
  "practitioner_unknown",
] as const;
export type OutsideRuleReason = (typeof OUTSIDE_RULE_REASONS)[number];

/** A free/busy block from the user's calendar (Q12). Free/busy carries no ids. */
export type BusyInterval = { readonly start: string; readonly end: string };

export type AcceptanceContext = {
  readonly now: Instant;
  /** The Brief's timezone: recurring windows are wall-clock times there. */
  readonly timezone: Brief["timezone"];
  /** The service's duration, for a slot offered without an end. */
  readonly defaultDurationMinutes?: number;
  /** For a reschedule: its own busy block is ignored, or it would block the slots beside it. */
  readonly existingAppointment?: { readonly startsAt: string; readonly endsAt?: string };
  /** What the callee actually said about the date, if the agent passed it on. */
  readonly heard?: HeardDate;
};

/** The slot as evaluated: its end filled in, both ends in the Brief's timezone's offset. */
export type EvaluatedSlot = {
  readonly start: string;
  readonly end: string;
  readonly practitioner?: string;
};

export type AcceptanceResult =
  | { readonly kind: "accept"; readonly slot: EvaluatedSlot }
  | {
      readonly kind: "reject";
      readonly reason: RejectReason;
      readonly mismatches?: readonly HeardDateMismatch[];
    }
  | {
      readonly kind: "outside_rule";
      readonly slot: EvaluatedSlot;
      readonly reasons: readonly OutsideRuleReason[];
    };

type Interval = { readonly start: Instant; readonly end: Instant };

const readInstant = (iso: string | undefined): Instant | undefined =>
  iso !== undefined && IsoDateTime.safeParse(iso).success ? tryInstantOf(iso) : undefined;

/** The service's duration if it is a sensible whole number of minutes, else the default. */
const serviceMinutes = (ctx: AcceptanceContext): number => {
  const d = ctx.defaultDurationMinutes;
  return d !== undefined && Number.isSafeInteger(d) && d > 0 && d <= MAX_SLOT_MINUTES
    ? d
    : DEFAULT_SLOT_MINUTES;
};

/** Every occurrence of `window` that could touch [from, to], as instants. */
const occurrences = (window: Window, from: Instant, to: Instant, timezone: string): Interval[] => {
  if (window.kind === "absolute") {
    return [
      { start: tryInstantOf(window.start) as Instant, end: tryInstantOf(window.end) as Instant },
    ];
  }
  const first = parseLocalDate(window.between.start);
  const last = parseLocalDate(window.between.end);
  // An occurrence belongs to the day it starts on, and may run past midnight: start a day early.
  let day: PlainDate = localDateOf(from, timezone).subtract({ days: 1 });
  const stop = localDateOf(to, timezone);
  const crossesMidnight = window.from > window.to;
  const out: Interval[] = [];
  for (; compareDates(day, stop) <= 0; day = day.add({ days: 1 })) {
    if (compareDates(day, first) < 0 || compareDates(day, last) > 0) continue;
    if (!window.days.includes(WEEKDAYS[isoWeekday(day) - 1] as (typeof WEEKDAYS)[number])) continue;
    const start = wallClockInstant(day, window.from, timezone);
    const end = wallClockInstant(crossesMidnight ? day.add({ days: 1 }) : day, window.to, timezone);
    // A DST gap can swallow a short window whole; an empty occurrence allows nothing.
    if (compareInstants(start, end) < 0) out.push({ start, end });
  }
  return out;
};

/** Merge overlapping or touching intervals, so adjacent windows form one allowed span. */
const union = (intervals: Interval[]): Interval[] => {
  const sorted = [...intervals].sort((a, b) => compareInstants(a.start, b.start));
  const out: Interval[] = [];
  for (const next of sorted) {
    const last = out.at(-1);
    if (last !== undefined && compareInstants(next.start, last.end) <= 0) {
      if (compareInstants(next.end, last.end) > 0)
        out[out.length - 1] = { start: last.start, end: next.end };
    } else {
      out.push(next);
    }
  }
  return out;
};

const inWindows = (rule: AcceptanceRule, slot: Interval, timezone: string): boolean =>
  union(rule.windows.flatMap((w) => occurrences(w, slot.start, slot.end, timezone))).some(
    (span) =>
      compareInstants(span.start, slot.start) <= 0 && compareInstants(slot.end, span.end) <= 0,
  );

/**
 * `undefined` if the calendar couldn't be read; otherwise whether the slot clashes. For a
 * reschedule, the one busy block that is the existing appointment is left out: same start, and
 * the same end (its `endsAt`, else start plus the service's duration). Free/busy carries no ids,
 * so an exact match is the best signal there is.
 */
const clashesWithCalendar = (
  rule: AcceptanceRule,
  slot: Interval,
  busy: readonly BusyInterval[],
  ctx: AcceptanceContext,
): boolean | undefined => {
  const existingStart = readInstant(ctx.existingAppointment?.startsAt);
  const existingEnd =
    existingStart === undefined
      ? undefined
      : ctx.existingAppointment?.endsAt === undefined
        ? addMinutes(existingStart, serviceMinutes(ctx))
        : readInstant(ctx.existingAppointment.endsAt);
  let skipped = false;
  let clash = false;
  for (const block of busy) {
    const start = readInstant(block.start);
    const end = readInstant(block.end);
    if (start === undefined || end === undefined || compareInstants(start, end) > 0)
      return undefined;
    const isExisting =
      !skipped &&
      existingStart !== undefined &&
      existingEnd !== undefined &&
      compareInstants(start, existingStart) === 0 &&
      compareInstants(end, existingEnd) === 0;
    if (isExisting) {
      skipped = true;
      continue;
    }
    // Half-open: a buffer that ends exactly where the slot starts doesn't clash.
    const from = addMinutes(start, -rule.bufferMinutes);
    const to = addMinutes(end, rule.bufferMinutes);
    if (compareInstants(slot.start, to) < 0 && compareInstants(from, slot.end) < 0) clash = true;
  }
  return clash;
};

const practitionerReasons = (
  rule: AcceptanceRule,
  offered: string | undefined,
): OutsideRuleReason[] => {
  const { mustBe, avoid = [] } = rule.practitioner ?? {};
  if (mustBe === undefined && avoid.length === 0) return [];
  if (offered === undefined || normalisePractitioner(offered) === "")
    return ["practitioner_unknown"];
  const reasons: OutsideRuleReason[] = [];
  if (mustBe !== undefined && !samePractitioner(mustBe, offered))
    reasons.push("practitioner_mismatch");
  if (avoid.some((name) => samePractitioner(name, offered))) reasons.push("practitioner_avoided");
  return reasons;
};

/**
 * Evaluate one offered slot against the rule. Total: for a rule from a parsed Brief it returns a
 * result for any slot, busy list and context, and never throws.
 */
export const evaluateAcceptance = (
  rule: AcceptanceRule,
  slot: Slot,
  busy: readonly BusyInterval[],
  ctx: AcceptanceContext,
): AcceptanceResult => {
  const start = readInstant(slot.start);
  if (start === undefined) return { kind: "reject", reason: "invalid_slot" };
  const duration = serviceMinutes(ctx);
  const end = slot.end === undefined ? addMinutes(start, duration) : readInstant(slot.end);
  if (end === undefined || compareInstants(end, start) <= 0)
    return { kind: "reject", reason: "invalid_slot" };
  if (minutesBetween(start, end) > MAX_SLOT_MINUTES)
    return { kind: "reject", reason: "invalid_slot" };
  if (ctx.heard !== undefined) {
    const mismatches = heardDateMismatches(start, ctx.heard, ctx.timezone);
    if (mismatches.length > 0) return { kind: "reject", reason: "inconsistent_date", mismatches };
  }
  if (compareInstants(start, ctx.now) < 0) return { kind: "reject", reason: "in_past" };

  const interval = { start, end };
  const evaluated: EvaluatedSlot = {
    start: toOffsetIso(start, ctx.timezone),
    end: toOffsetIso(end, ctx.timezone),
    ...(slot.practitioner === undefined ? {} : { practitioner: slot.practitioner }),
  };

  const reasons: OutsideRuleReason[] = [];
  if (!inWindows(rule, interval, ctx.timezone)) reasons.push("not_in_window");
  if (rule.avoidCalendarConflicts) {
    const clash = clashesWithCalendar(rule, interval, busy, ctx);
    if (clash === undefined) reasons.push("calendar_unreadable");
    else if (clash) reasons.push("calendar_conflict");
  }
  if (
    rule.minNoticeHours !== undefined &&
    compareInstants(start, addHours(ctx.now, rule.minNoticeHours)) < 0
  ) {
    reasons.push("too_soon");
  }
  reasons.push(...practitionerReasons(rule, slot.practitioner));

  return reasons.length === 0
    ? { kind: "accept", slot: evaluated }
    : { kind: "outside_rule", slot: evaluated, reasons };
};

/**
 * The accepted slots in the order the user's `preference` ranks them (M1-Q9: code picks, not the
 * agent). Ties keep the earlier start, then the order they were offered in. Slots whose start
 * can't be read go last.
 */
export const rankByPreference = <S extends { readonly start: string }>(
  preference: Preference,
  slots: readonly S[],
): S[] => {
  const target = typeof preference === "object" ? tryInstantOf(preference.closestTo) : undefined;
  const keyed = slots.map((slot, index) => ({ slot, index, at: tryInstantOf(slot.start) }));
  keyed.sort((a, b) => {
    if (a.at === undefined || b.at === undefined) {
      return (a.at === undefined ? 1 : 0) - (b.at === undefined ? 1 : 0) || a.index - b.index;
    }
    const byTime = compareInstants(a.at, b.at);
    if (preference === "earliest") return byTime || a.index - b.index;
    if (preference === "latest") return -byTime || a.index - b.index;
    const distance = (x: Instant): number =>
      target === undefined ? 0 : Math.abs(minutesBetween(target, x));
    return distance(a.at) - distance(b.at) || byTime || a.index - b.index;
  });
  return keyed.map((k) => k.slot);
};

/** The slot the user's preference picks, or `undefined` when there are none. */
export const pickPreferred = <S extends { readonly start: string }>(
  preference: Preference,
  slots: readonly S[],
): S | undefined => rankByPreference(preference, slots)[0];
