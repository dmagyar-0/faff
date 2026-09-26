import fc from "fast-check";

/**
 * Every property test in core runs at least 1,000 cases from a fixed seed, so a failure is
 * reproducible: fast-check prints the seed and the counterexample path when a property fails.
 * Set FC_SEED to explore other seeds locally. Tests may raise `numRuns`, never lower it.
 */
const raw = process.env["FC_SEED"];
const seed = raw === undefined ? 20260924 : Number(raw);
if (raw !== undefined && (raw.trim() === "" || !Number.isSafeInteger(seed))) {
  throw new Error(`FC_SEED must be an integer, got ${JSON.stringify(raw)}`);
}
fc.configureGlobal({ numRuns: 1000, seed });
