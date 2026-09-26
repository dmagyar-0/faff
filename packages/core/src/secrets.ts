/**
 * `rejectSecrets` (I-6, spec 05, M1 plan §3.9): Faff never stores authentication secrets or
 * payment details, so free text (Brief notes, user-business notes, chat persisted into Briefs) is
 * scanned on write and a match is rejected.
 *
 * Detectors run on NFKC-normalised text, so full-width digits can't slip past:
 * - **card_number**: 13–19 digits in any grouping of single spaces or dashes, starting 2–6 (the
 *   card networks), Luhn-valid.
 * - **bank_details**: a sort code (`nn-nn-nn`, `nn nn nn` or `nnnnnn`) with "sort code" just
 *   before it or an 8-digit account number near it; or "account number" followed by 8 digits.
 *   A bare `14-10-26` is a date.
 * - **secret_value**: a secret's name followed by something that looks like its value ("my PIN is
 *   4471", "password: hunter2"). A bare mention ("they may ask for a PIN — say you don't have
 *   it") passes: that's exactly the note we want (M1-Q8a).
 *
 * `rejectProfileValues` (G21, M1-Q8b) also rejects notes that contain one of the user's own
 * profile values, so a date of birth typed into the notes can't reach the phone prompt around
 * `reveal_profile_field` (D3, I-7).
 */
import type { ProfileField } from "./primitives";
import { err, ok, type Result } from "./result";

export const SECRET_KINDS = ["card_number", "bank_details", "secret_value"] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

/** Where the match is, as [start, end) offsets into the NFKC-normalised text. */
export type Span = readonly [number, number];

export const normaliseForScan = (text: string): string => text.normalize("NFKC");

const luhn = (digits: string): boolean => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
};

/** Digit runs that may be grouped by single spaces or dashes. */
const DIGIT_RUN = /(?<![\d])\d(?:[ -]?\d)+(?![\d])/g;

const findCard = (text: string): Span | undefined => {
  for (const m of text.matchAll(DIGIT_RUN)) {
    const digits = m[0].replace(/[ -]/g, "");
    if (digits.length >= 13 && digits.length <= 19 && /^[2-6]/.test(digits) && luhn(digits)) {
      return [m.index, m.index + m[0].length];
    }
  }
  return undefined;
};

const SORT_CODE = /(?<![\d-])(\d{2}[- ]\d{2}[- ]\d{2}|\d{6})(?![\d-])/g;
const SORT_CODE_WORDS = /sort[\s-]*code\W{0,12}$/i;
/** A sort code written right next to an 8-digit account number, either way round. */
const SORT_THEN_ACCOUNT = /^\W{1,3}\d{8}(?!\d)/;
const ACCOUNT_THEN_SORT = /(?<!\d)\d{8}\W{1,3}$/;
const ACCOUNT_WORDS = /\b(?:account|acc|a\/c)(?:\s*(?:number|no\.?|num|#))?\W{0,6}\d{8}(?![\d])/gi;

/**
 * A date written like a sort code (`14-10-26`) is common in notes, often near a booking
 * reference, so a sort code counts only with the words "sort code" before it or an account
 * number directly beside it.
 */
const findBank = (text: string): Span | undefined => {
  for (const m of text.matchAll(SORT_CODE)) {
    const start = m.index;
    const end = start + m[0].length;
    if (SORT_CODE_WORDS.test(text.slice(Math.max(0, start - 30), start))) return [start, end];
    const after = SORT_THEN_ACCOUNT.exec(text.slice(end, end + 12));
    if (after !== null) return [start, end + after[0].length];
    const before = ACCOUNT_THEN_SORT.exec(text.slice(Math.max(0, start - 12), start));
    if (before !== null) return [start - before[0].length, end];
  }
  for (const m of text.matchAll(ACCOUNT_WORDS)) return [m.index, m.index + m[0].length];
  return undefined;
};

/** Secrets whose value is a short number: PINs, card security codes, one-time codes. */
const NUMERIC_SECRETS =
  "pin(?:\\s*(?:number|code))?|passcode|cvv2?|cvc|csc|card\\s+security\\s+code|security\\s+code|one[\\s-]*time\\s+(?:pass)?code|otp|verification\\s+code|auth(?:entication)?\\s+code";
const NUMERIC_SECRET = new RegExp(
  `\\b(?:${NUMERIC_SECRETS})\\b[^\\w\\n]{0,3}(?:(?:is|was|=|:|of|number|code)[^\\w\\n]{0,3}){0,2}(\\d(?:[ -]?\\d){2,7})(?![\\d])`,
  "gi",
);

/** Secrets whose value is a word or phrase: passwords, memorable words, security answers. */
const WORD_SECRETS =
  "password|passphrase|pass\\s*word|memorable\\s+(?:word|information|info|answer)|(?:mother'?s|mum'?s|mom'?s)\\s+maiden\\s+name|maiden\\s+name|security\\s+answer|secret\\s+answer|answer\\s+to\\s+(?:my|the)\\s+security\\s+question|security\\s+question\\s+answer";
const WORD_SECRET = new RegExp(
  `\\b(?:${WORD_SECRETS})\\b\\s*(?::|=|\\bis\\b|\\bwas\\b|\\bis\\s+set\\s+to\\b)\\s*(["'“‘]?)([^\\s"'”’.,;!?]{2,})`,
  "gi",
);
/** Words that follow "password is" without being a password. */
const NOT_A_VALUE = new Set([
  "a",
  "an",
  "the",
  "not",
  "never",
  "no",
  "on",
  "in",
  "at",
  "for",
  "required",
  "needed",
  "unknown",
  "something",
  "what",
  "which",
  "that",
  "this",
  "it",
  "my",
  "your",
  "their",
  "his",
  "her",
  "same",
  "written",
  "saved",
  "stored",
  "kept",
  "blank",
  "empty",
  "missing",
  "wrong",
  "correct",
  "optional",
  "asked",
  "usually",
  "probably",
  "definitely",
  "also",
  "still",
  "being",
  "going",
  "to",
]);

const findSecretValue = (text: string): Span | undefined => {
  for (const m of text.matchAll(NUMERIC_SECRET)) return [m.index, m.index + m[0].length];
  for (const m of text.matchAll(WORD_SECRET)) {
    // A quoted value is a value, even if it's an ordinary word ("correct horse").
    const [, quote, token] = m as unknown as [string, string, string];
    const quoted = quote !== "";
    const value = token.toLowerCase();
    if (quoted || !NOT_A_VALUE.has(value)) return [m.index, m.index + m[0].length];
  }
  return undefined;
};

/**
 * `ok` with the normalised text when nothing matches; otherwise the first kind found (cards,
 * then bank details, then keyword values) and where it is.
 */
export const rejectSecrets = (
  text: string,
): Result<string, SecretKind, { readonly span: Span }> => {
  const normalised = normaliseForScan(text);
  const card = findCard(normalised);
  if (card !== undefined) return err("card_number", { span: card });
  const bank = findBank(normalised);
  if (bank !== undefined) return err("bank_details", { span: bank });
  const secret = findSecretValue(normalised);
  if (secret !== undefined) return err("secret_value", { span: secret });
  return ok(normalised);
};

// --- G21: the user's own profile values ---------------------------------------------------

export type ProfileValues = Partial<Readonly<Record<ProfileField, string>>>;

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

/** NFKC, case-folded, every run of anything but letters and digits collapsed to one space. */
const fold = (text: string): string =>
  normaliseForScan(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const ordinal = (day: number): string => {
  const teen = day % 100 >= 11 && day % 100 <= 13;
  const suffix = teen ? "th" : (["th", "st", "nd", "rd"][day % 10] ?? "th");
  return `${day}${suffix}`;
};

/** Every common way to write a date of birth given as `YYYY-MM-DD`, folded. */
const dateSpellings = (iso: string): string[] => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (m === null) return [fold(iso)];
  const [, y, mm, dd] = m as unknown as [string, string, string, string];
  const month = MONTHS[Number(mm) - 1] ?? "";
  const days = [dd, String(Number(dd)), ordinal(Number(dd))];
  const months = [mm, String(Number(mm)), month, month.slice(0, 3)];
  const years = [y, y.slice(2)];
  const out = new Set<string>([`${y} ${mm} ${dd}`]);
  for (const d of days) {
    for (const mo of months) {
      for (const yr of years) {
        out.add(`${d} ${mo} ${yr}`);
        out.add(`${d} of ${mo} ${yr}`);
        out.add(`${mo} ${d} ${yr}`);
      }
    }
  }
  return [...out];
};

const digitsOnly = (text: string): string => normaliseForScan(text).replace(/\D/g, "");

/** Fields that hold no value worth matching. */
const SKIP: ReadonlySet<ProfileField> = new Set(["existing_patient"]);

export const PROFILE_VALUE_REASONS = ["profile_value"] as const;
export type ProfileValueReason = (typeof PROFILE_VALUE_REASONS)[number];

/**
 * `ok` unless `text` contains one of the user's own profile values, in any usual spelling. The
 * web server calls it at draft time with the user's values, before a Brief revision is written.
 * Values of three characters or fewer are ignored: they'd match by accident.
 */
export const rejectProfileValues = (
  text: string,
  values: ProfileValues,
): Result<true, ProfileValueReason, { readonly field: ProfileField }> => {
  const words = ` ${fold(text)} `;
  const squashed = words.replace(/ /g, "");
  const digits = digitsOnly(text);
  const contains = (phrase: string): boolean => phrase !== "" && words.includes(` ${phrase} `);
  for (const [field, raw] of Object.entries(values) as [ProfileField, string | undefined][]) {
    if (raw === undefined || SKIP.has(field) || fold(raw).replace(/ /g, "").length <= 3) continue;
    let hit: boolean;
    switch (field) {
      case "date_of_birth":
        hit = dateSpellings(raw).some(contains);
        break;
      case "postcode":
        hit = squashed.includes(fold(raw).replace(/ /g, ""));
        break;
      case "contact_phone":
      case "nhs_number": {
        const national = digitsOnly(raw).replace(/^44/, "0");
        const international = national.replace(/^0/, "44");
        hit = national.length >= 7 && (digits.includes(national) || digits.includes(international));
        break;
      }
      default:
        hit = contains(fold(raw));
    }
    if (hit) return err("profile_value", { field });
  }
  return ok(true);
};
