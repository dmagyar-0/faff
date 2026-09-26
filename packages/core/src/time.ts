/**
 * The only module that imports Temporal (M1 plan §2). Moving to native Temporal is a one-line
 * change here. Nothing in this file reads the clock: `now` is always an argument.
 *
 * Wall-clock maths goes through `ZonedDateTime` in the Brief's timezone with
 * `disambiguation: "compatible"`: a wall time that doesn't exist (01:30 on a spring-forward day)
 * resolves forward, and one that exists twice (01:30 on a fall-back day) resolves to the earlier.
 * Comparisons are always made on instants.
 */
import { Temporal } from "temporal-polyfill";

export { Temporal };
export type Instant = Temporal.Instant;
export type PlainDate = Temporal.PlainDate;

/** An RFC 3339 datetime with an offset, as an instant. The caller has already validated it. */
export const instantOf = (iso: string): Temporal.Instant => Temporal.Instant.from(iso);

/** The instant, or `undefined` if Temporal can't read the string. Never throws. */
export const tryInstantOf = (iso: string): Temporal.Instant | undefined => {
  try {
    return Temporal.Instant.from(iso);
  } catch {
    return undefined;
  }
};

/**
 * Negative if `a` is before `b`, zero if they are the same instant, positive if after, and
 * `undefined` if either isn't a readable instant. Never throws, so schema refinements can call
 * it on input that failed its format check.
 */
export const compareIso = (a: string, b: string): number | undefined => {
  const x = tryInstantOf(a);
  const y = tryInstantOf(b);
  return x === undefined || y === undefined ? undefined : Temporal.Instant.compare(x, y);
};

export const compareInstants = (a: Temporal.Instant, b: Temporal.Instant): number =>
  Temporal.Instant.compare(a, b);

export const addMinutes = (at: Temporal.Instant, minutes: number): Temporal.Instant =>
  at.add({ minutes });

export const addHours = (at: Temporal.Instant, hours: number): Temporal.Instant =>
  at.add({ minutes: Math.round(hours * 60) });

export const minutesBetween = (a: Temporal.Instant, b: Temporal.Instant): number =>
  b.since(a).total({ unit: "minutes" });

/** The local calendar date of an instant in `timezone`. */
export const localDateOf = (at: Temporal.Instant, timezone: string): Temporal.PlainDate =>
  at.toZonedDateTimeISO(timezone).toPlainDate();

export const compareDates = (a: Temporal.PlainDate, b: Temporal.PlainDate): number =>
  Temporal.PlainDate.compare(a, b);

export const parseLocalDate = (date: string): Temporal.PlainDate => Temporal.PlainDate.from(date);

/**
 * The instant at wall-clock `time` ("HH:MM") on local `date` in `timezone`. A time the DST change
 * skips resolves forward; a time it repeats resolves to the earlier of the two.
 */
export const wallClockInstant = (
  date: Temporal.PlainDate,
  time: string,
  timezone: string,
): Temporal.Instant => {
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  return Temporal.ZonedDateTime.from(
    { year: date.year, month: date.month, day: date.day, hour, minute, timeZone: timezone },
    { disambiguation: "compatible" },
  ).toInstant();
};

/** 1 = Monday … 7 = Sunday, as ISO 8601 and Temporal number them. */
export const isoWeekday = (date: Temporal.PlainDate): number => date.dayOfWeek;

/** An instant as RFC 3339 in `timezone`'s offset at that moment, e.g. `2026-10-05T09:00:00+01:00`. */
export const toOffsetIso = (at: Temporal.Instant, timezone: string): string =>
  at.toZonedDateTimeISO(timezone).toString({ timeZoneName: "never", smallestUnit: "second" });
