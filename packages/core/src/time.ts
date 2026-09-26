/**
 * The only module that imports Temporal (M1 plan §2). Moving to native Temporal is a one-line
 * change here. Nothing in this file reads the clock: `now` is always an argument.
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
