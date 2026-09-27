/**
 * Working days (G13, M1-Q3): Monday to Friday, less the bank holidays the caller passes in. The
 * en-GB list (England & Wales) lives in the locale catalogue; Scotland and Northern Ireland differ,
 * a known, small inaccuracy for v1.
 */
import { Temporal, type Instant, type PlainDate } from "./time";

/** ISO dates (`YYYY-MM-DD`) that aren't working days even though they fall Monday to Friday. */
export type Holidays = readonly string[];

export const isWorkingDate = (date: PlainDate, holidays: Holidays): boolean =>
  date.dayOfWeek <= 5 && !holidays.includes(date.toString());

/**
 * `n` working days after `at`, at the same wall-clock time in `timezone`: Friday 16:00 plus two
 * working days is Tuesday 16:00, and Saturday 10:00 plus one is Monday 10:00. A wall time the DST
 * change skips resolves forward.
 */
export const addWorkingDays = (
  at: Instant,
  n: number,
  timezone: string,
  holidays: Holidays,
): Instant => {
  let zoned = at.toZonedDateTimeISO(timezone);
  let counted = 0;
  while (counted < n) {
    zoned = zoned.add({ days: 1 }, { overflow: "constrain" });
    if (isWorkingDate(zoned.toPlainDate(), holidays)) counted++;
  }
  return zoned.toInstant();
};

/** Whether `later` is no more than `n` working days after `earlier`. */
export const withinWorkingDays = (
  earlier: Instant,
  later: Instant,
  n: number,
  timezone: string,
  holidays: Holidays,
): boolean => Temporal.Instant.compare(later, addWorkingDays(earlier, n, timezone, holidays)) <= 0;
