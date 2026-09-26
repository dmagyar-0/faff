/**
 * `checkHeardDate` (M1 plan §3.5). The LLM turns speech into an ISO datetime and may silently
 * pick one reading of "Tuesday the 14th" when the 14th is a Wednesday. Carrying what was heard
 * alongside the ISO value lets code catch the contradiction instead of hoping the model did.
 */
import type { Weekday } from "./primitives";
import { WEEKDAYS } from "./primitives";
import { err, ok, type Result } from "./result";
import { localDateOf, tryInstantOf } from "./time";

/** What the callee said, as far as it went. Every part is optional. */
export type HeardDate = {
  readonly weekday?: Weekday;
  /** 1–31. */
  readonly dayOfMonth?: number;
  /** 1–12. */
  readonly month?: number;
};

export type HeardDateMismatch = {
  readonly field: "weekday" | "dayOfMonth" | "month";
  readonly heard: string | number;
  readonly actual: string | number;
};

export const HEARD_DATE_REASONS = ["inconsistent_date", "invalid_datetime"] as const;
export type HeardDateReason = (typeof HEARD_DATE_REASONS)[number];

/**
 * `ok` when every part of what was heard agrees with the local date of `start` in `timezone`;
 * otherwise `inconsistent_date` with each mismatch, so the agent can clarify rather than guess.
 */
export const checkHeardDate = (
  input: { readonly start: string; readonly heard: HeardDate },
  timezone: string,
): Result<true, HeardDateReason, readonly HeardDateMismatch[]> => {
  const at = tryInstantOf(input.start);
  if (at === undefined) return err("invalid_datetime");
  const date = localDateOf(at, timezone);
  const actualWeekday = WEEKDAYS[date.dayOfWeek - 1] as Weekday;
  const { weekday, dayOfMonth, month } = input.heard;

  const mismatches: HeardDateMismatch[] = [];
  if (weekday !== undefined && weekday !== actualWeekday) {
    mismatches.push({ field: "weekday", heard: weekday, actual: actualWeekday });
  }
  if (dayOfMonth !== undefined && dayOfMonth !== date.day) {
    mismatches.push({ field: "dayOfMonth", heard: dayOfMonth, actual: date.day });
  }
  if (month !== undefined && month !== date.month) {
    mismatches.push({ field: "month", heard: month, actual: date.month });
  }
  return mismatches.length === 0 ? ok(true) : err("inconsistent_date", mismatches);
};
