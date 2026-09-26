/**
 * The only module that imports Temporal (M1 plan §2). Moving to native Temporal is a one-line
 * change here. Nothing in this file reads the clock: `now` is always an argument.
 */
import { Temporal } from "temporal-polyfill";

export { Temporal };

/** An RFC 3339 datetime with an offset, as an instant. The caller has already validated it. */
export const instantOf = (iso: string): Temporal.Instant => Temporal.Instant.from(iso);

/** Negative if `a` is before `b`, zero if they are the same instant, positive if after. */
export const compareIso = (a: string, b: string): number =>
  Temporal.Instant.compare(instantOf(a), instantOf(b));
