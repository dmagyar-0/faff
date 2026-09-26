/**
 * `matchBusinessIdentity` (G9, spec 08 "Callee identity check", M1 plan §3.12): did the callee
 * name the business the Brief is for? Deterministic, and built for speech-recognised text: "smile
 * dent all" is Smile Dental. `confirm_business_identity` (M4) wraps it; on `match` the call's
 * `identity_confirmed` is set, on `mismatch` the agent ends the call, on `unclear` it asks once.
 *
 * The thresholds are provisional until the M6 noise scenarios tune them.
 */

/** Words that say nothing about which business it is. */
const GENERIC = new Set([
  "the",
  "a",
  "an",
  "and",
  "of",
  "at",
  "in",
  "on",
  "practice",
  "surgery",
  "ltd",
  "limited",
  "llp",
  "plc",
  "co",
  "company",
  "uk",
  "group",
]);

/** At or above this, the names match. */
export const MATCH_THRESHOLD = 0.8;
/** At or below this, they don't. In between is unclear, and the agent asks once. */
export const MISMATCH_THRESHOLD = 0.4;

export type IdentityVerdict = "match" | "mismatch" | "unclear";

const tokens = (text: string): string[] =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((w) => w !== "" && !GENERIC.has(w));

const levenshtein = (a: string, b: string): number => {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row.push(
        Math.min(
          (prev[j] as number) + 1,
          (row[j - 1] as number) + 1,
          (prev[j - 1] as number) + cost,
        ),
      );
    }
    prev = row;
  }
  return prev[b.length] as number;
};

/** 1 for identical, 0 for nothing in common. */
const editSimilarity = (a: string, b: string): number => {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 0 : 1 - levenshtein(a, b) / longest;
};

/** Dice coefficient on the word sets. */
const tokenSimilarity = (a: readonly string[], b: readonly string[]): number => {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size + setB.size === 0) return 0;
  let shared = 0;
  for (const w of setA) if (setB.has(w)) shared++;
  return (2 * shared) / (setA.size + setB.size);
};

/**
 * How alike two names are, 0–1: the better of word overlap ("Bright Smile" vs "Smile Dental" is
 * 0.5) and spelling with the spaces taken out ("smile dent all" vs "Smile Dental" is 0.92), so
 * misheard word breaks don't count against a match.
 */
export const nameSimilarity = (heard: string, name: string): number => {
  const h = tokens(heard);
  const n = tokens(name);
  return Math.max(tokenSimilarity(h, n), editSimilarity(h.join(""), n.join("")));
};

/**
 * The names the callee might reasonably say: the display name; the part before its first comma
 * ("Smile Dental, Clapham" → "Smile Dental"); the display name without the location's words; and
 * every alias.
 */
const candidateNames = (
  business: { readonly displayName: string; readonly location?: string },
  aliases: readonly string[],
): string[] => {
  const beforeComma = business.displayName.split(",", 1).join("");
  const place = new Set(tokens(business.location ?? ""));
  const withoutPlace = tokens(business.displayName)
    .filter((w) => !place.has(w))
    .join(" ");
  return [business.displayName, beforeComma, withoutPlace, ...aliases].filter(
    (n) => tokens(n).length > 0,
  );
};

const verdictOf = (score: number): IdentityVerdict =>
  score >= MATCH_THRESHOLD ? "match" : score <= MISMATCH_THRESHOLD ? "mismatch" : "unclear";

/**
 * Compare what the callee said with the business's display name and every alias. When the callee
 * also gave a location and the business has one, a clearly different location ("the Balham
 * branch") is a mismatch, and an unclear one makes the whole answer unclear.
 */
export const matchBusinessIdentity = (
  heard: { readonly name: string; readonly location?: string },
  business: { readonly displayName: string; readonly location?: string },
  aliases: readonly string[] = [],
): IdentityVerdict => {
  const candidates = candidateNames(business, aliases);
  // Nothing identifiable heard ("hello?"), or nothing to compare with: ask, don't decide.
  if (tokens(heard.name).length === 0 || candidates.length === 0) return "unclear";
  const best = Math.max(...candidates.map((n) => nameSimilarity(heard.name, n)));
  const name = verdictOf(best);
  if (name !== "match" || heard.location === undefined || business.location === undefined)
    return name;
  if (tokens(heard.location).length === 0) return name;
  return verdictOf(nameSimilarity(heard.location, business.location));
};
