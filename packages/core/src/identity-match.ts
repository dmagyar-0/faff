/**
 * `matchBusinessIdentity` (G9, spec 08 "Callee identity check", M1 plan §3.12): did the callee
 * name the business the Brief is for? Deterministic, and built for speech-recognised text: "smile
 * dent all" is Smile Dental. `confirm_business_identity` (M4) wraps it; on `match` the call's
 * `identity_confirmed` is set, on `mismatch` the agent ends the call, on `unclear` it asks once.
 *
 * A `match` sets `identity_confirmed`, which lets `reveal_profile_field` release the user's
 * details (I-7), so it errs towards `unclear`: that costs one clarifying question. The spelling
 * tolerance is provisional until the M6 noise scenarios tune it.
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

/**
 * What a business is, not which one: a name made only of these ("Dental Practice", "the
 * Pharmacy") could be any of thousands, so it never identifies the business on its own.
 */
const CATEGORY = new Set([
  "dental",
  "dentist",
  "dentists",
  "dentistry",
  "pharmacy",
  "chemist",
  "clinic",
  "medical",
  "centre",
  "center",
  "health",
  "healthcare",
  "care",
  "family",
  "opticians",
  "optician",
  "optometrists",
  "eye",
  "eyecare",
  "vets",
  "vet",
  "veterinary",
  "physio",
  "physiotherapy",
  "hair",
  "salon",
  "beauty",
  "barbers",
  "garage",
  "motors",
  "gp",
  "doctors",
  "hospital",
]);

/**
 * What a receptionist says that isn't a name ("Good morning", "Yes, speaking", "Reception, how
 * can I help?"). Dropped from what was heard, so a greeting on its own is `unclear`, never a
 * `mismatch` that would end the call and mark a good number wrong.
 */
const FILLER = new Set([
  "hello",
  "hi",
  "hey",
  "hiya",
  "good",
  "morning",
  "afternoon",
  "evening",
  "yes",
  "yeah",
  "yep",
  "speaking",
  "reception",
  "how",
  "can",
  "may",
  "i",
  "help",
  "you",
  "this",
  "is",
  "it",
  "its",
  "sorry",
  "pardon",
  "what",
  "who",
  "thank",
  "thanks",
  "calling",
  "here",
  "hold",
  "please",
  "one",
  "moment",
  "sure",
  "ok",
  "okay",
  "well",
  "um",
  "uh",
  "er",
  "erm",
]);

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

/**
 * Whether a heard word is the same word misheard. Exact, or for longer words a small spelling
 * slip with the same first letter: "smiles" is Smile, "dentall" is Dental, but "style" isn't
 * Smile and "roots" isn't Boots. Short words must match exactly.
 */
export const sameWord = (heard: string, word: string): boolean => {
  if (heard === word) return true;
  if (heard[0] !== word[0]) return false;
  const longest = Math.max(heard.length, word.length);
  const allowed = longest >= 9 ? 2 : longest >= 6 ? 1 : 0;
  return allowed > 0 && levenshtein(heard, word) <= allowed;
};

/**
 * Compare what was heard with one name, word by word. Each of the name's words must be heard,
 * alone or as up to three heard words run together ("dent all" is "dental"). Then:
 * - every word heard, and nothing else distinctive: `match`;
 * - every word heard, plus another distinctive word (another branch, "Balham"): `unclear`;
 * - some of the words: `unclear`; none: `mismatch`.
 */
export const compareNames = (heard: string, name: string): IdentityVerdict => {
  const h = tokens(heard).filter((w) => !FILLER.has(w));
  const n = tokens(name);
  // Nothing but a greeting heard, or a name of category words only: ask, don't decide.
  if (h.length === 0 || n.every((w) => CATEGORY.has(w))) return "unclear";
  const used = new Set<number>();
  let matched = 0;
  // A one-word slip ("Kensington" for "Kennington") could be a different business: it can make
  // the answer unclear, never a match. Heard words run together are how speech recognition breaks
  // a word, so a slip there still counts.
  let slipped = false;
  for (const word of n) {
    let found = false;
    for (let i = 0; i < h.length && !found; i++) {
      for (let len = 1; len <= 3 && i + len <= h.length && !found; len++) {
        const indices = Array.from({ length: len }, (_, k) => i + k);
        if (indices.some((k) => used.has(k))) continue;
        const joined = indices.map((k) => h[k]).join("");
        if (sameWord(joined, word)) {
          indices.forEach((k) => used.add(k));
          found = true;
          if (len === 1 && joined !== word) slipped = true;
        }
      }
    }
    if (found) matched++;
  }
  if (matched === 0) return "mismatch";
  if (matched < n.length) return "unclear";
  return used.size === h.length && !slipped ? "match" : "unclear";
};

const RANK: Readonly<Record<IdentityVerdict, number>> = { mismatch: 0, unclear: 1, match: 2 };
const best = (verdicts: readonly IdentityVerdict[]): IdentityVerdict =>
  verdicts.reduce<IdentityVerdict>((a, b) => (RANK[b] > RANK[a] ? b : a), "mismatch");

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
  // The location's words come off the end only ("Smile Dental Clapham"), never the front, where
  // they are part of the name ("Clapham Dental").
  const place = tokens(business.location ?? "");
  const words = tokens(business.displayName);
  const tail = words.slice(-place.length);
  const withoutPlace =
    place.length > 0 && tail.join(" ") === place.join(" ")
      ? words.slice(0, -place.length).join(" ")
      : business.displayName;
  return [business.displayName, beforeComma, withoutPlace, ...aliases].filter(
    (n) => tokens(n).length > 0,
  );
};

/**
 * Compare what the callee said with the business's display name and every alias, and take the
 * best verdict. When the callee also gave a location and the business has one, the location must
 * match too; one that doesn't is unclear, so the agent asks once.
 *
 * Nothing identifiable heard ("hello?"), or nothing to compare with, is `unclear`: ask once,
 * don't decide.
 */
export const matchBusinessIdentity = (
  heard: { readonly name: string; readonly location?: string },
  business: { readonly displayName: string; readonly location?: string },
  aliases: readonly string[] = [],
): IdentityVerdict => {
  const candidates = candidateNames(business, aliases);
  if (tokens(heard.name).length === 0 || candidates.length === 0) return "unclear";
  const name = best(candidates.map((n) => compareNames(heard.name, n)));
  if (name !== "match" || heard.location === undefined || business.location === undefined) {
    return name;
  }
  if (tokens(heard.location).length === 0) return name;
  // The name matched: a location that doesn't is worth one question before ending the call.
  const place = compareNames(heard.location, business.location);
  return place === "mismatch" ? "unclear" : place;
};
