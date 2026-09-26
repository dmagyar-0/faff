/**
 * `rejectSecrets` (I-6, spec 05, M1 plan §3.9): Faff never stores authentication secrets or
 * payment details, so free text (Brief notes, user-business notes, chat persisted into Briefs) is
 * scanned on write and a match is rejected.
 *
 * Detectors run on NFKC-normalised text, so full-width digits can't slip past:
 * - **card_number**: 13–19 digits starting 2–6 (the card networks), Luhn-valid, as one block, a
 *   printed grouping or blocks of three or more, separated by spaces, tabs, line breaks, dashes or
 *   dots (spec 05 has the full rule).
 * - **bank_details**: an IBAN that passes its checksum; a sort code (`nn-nn-nn`, `nn nn nn` or
 *   `nnnnnn`) with "sort code" just before it or an 8-digit account number directly beside it; or
 *   "account number" followed by 8 digits. A bare `14-10-26` is a date.
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

/**
 * The longest text scanned, in characters before NFKC (which can expand a character to a few,
 * as "⒈" to "1."). Longer text is refused rather than scanned (`too_long`), so the scan's cost
 * has a bound; no note or chat message Faff keeps is anywhere near it.
 */
export const MAX_SCAN_LENGTH = 20_000;
export type SecretKind = (typeof SECRET_KINDS)[number];
/** Every reason `rejectSecrets` can give. */
export const SECRET_REASONS = [...SECRET_KINDS, "too_long"] as const;
export type SecretReason = (typeof SECRET_REASONS)[number];

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

/** Runs of digits grouped by up to three spaces, tabs or line breaks, or a dash (any kind) or dot. */
const DIGIT_RUN = /(?<!\d)\d(?:(?:[ \t\r\n]{1,3}|[.\-–—]|[ \t]?[-–—]{1,2}[ \t]?)?\d)+(?!\d)/g;

/** No card, phone or NHS number has more digits than this, so no span needs more. */
const MAX_DIGITS = 19;

/** A run split into its digit groups, each with its offset in the text. */
const groupsOf = (run: string, offset: number): { digits: string; start: number; end: number }[] =>
  [...run.matchAll(/\d+/g)].map((g) => ({
    digits: g[0],
    start: offset + g.index,
    end: offset + g.index + g[0].length,
  }));

/** A span of consecutive digit groups: its digits, where it is, and how it was grouped. */
export type DigitSpan = {
  readonly digits: string;
  readonly span: Span;
  /** The lengths of its groups, in order. */
  readonly groups: readonly number[];
  /** Whether it is the whole run, not part of a longer one. */
  readonly whole: boolean;
};

/**
 * Every span of consecutive groups, up to 19 digits, in every digit run. A card written with its
 * expiry or security code after it ("4111 1111 1111 1111 12 28") is one run; the card is one of
 * its spans. Capping spans at 19 digits keeps a long run of digits linear.
 */
export const digitSpans = (text: string): DigitSpan[] => {
  const out: DigitSpan[] = [];
  for (const m of text.matchAll(DIGIT_RUN)) {
    const groups = groupsOf(m[0], m.index);
    for (let i = 0; i < groups.length; i++) {
      let digits = "";
      const lengths: number[] = [];
      for (let j = i; j < groups.length; j++) {
        const g = groups[j] as { digits: string; start: number; end: number };
        digits += g.digits;
        if (digits.length > MAX_DIGITS) break;
        lengths.push(g.digits.length);
        out.push({
          digits,
          span: [(groups[i] as { start: number }).start, g.end],
          groups: [...lengths],
          whole: i === 0 && j === groups.length - 1,
        });
      }
    }
  }
  return out;
};

/** How cards are printed: 4-4-4-4 (and 4-4-4-4-3), Amex 4-6-5, Diners 4-6-4, or one block. */
const CARD_GROUPINGS = new Set(["4,4,4,4", "4,4,4,4,3", "4,4,4,4,2", "4,6,5", "4,6,4", "4,4,4,1"]);
const cardShaped = (s: DigitSpan): boolean =>
  s.groups.length === 1 ||
  CARD_GROUPINGS.has(s.groups.join(",")) ||
  (s.whole && s.groups.every((n) => n >= 3));

/**
 * A Luhn-valid 13–19 digit number starting 2–6, grouped the way cards are written: one block, a
 * printed grouping (4-4-4-4, 4-6-5…), or, as a whole run on its own, blocks of 3 or more.
 * Numbers written side by side (two phone numbers, a date and a time) pass Luhn one time in ten,
 * and they aren't a card.
 */
const findCard = (text: string): Span | undefined =>
  digitSpans(text).find(
    (s) => s.digits.length >= 13 && /^[2-6]/.test(s.digits) && cardShaped(s) && luhn(s.digits),
  )?.span;

/** ISO 13616 check: move the first four characters to the end, letters to numbers, mod 97. */
const ibanValid = (iban: string): boolean => {
  const moved = (iban.slice(4) + iban.slice(0, 4)).toUpperCase();
  let rest = 0;
  for (const ch of moved) {
    const code = ch.charCodeAt(0);
    const value = code >= 65 ? String(code - 55) : ch;
    for (const d of value) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1;
};
const IBAN = /\b[A-Za-z]{2}\d{2}(?: ?[A-Za-z0-9]{4}){2,7}(?: ?[A-Za-z0-9]{1,4})?\b/g;

const SORT_CODE = /(?<![\d-])(\d{2}[- ]\d{2}[- ]\d{2}|\d{6})(?![\d-])/g;
const SORT_CODE_WORDS = /sort[\s-]*code\W{0,3}(?:(?:is|was|=|:)\W{0,3}){0,2}$/i;
/** A sort code written right next to an 8-digit account number, either way round. */
const SORT_THEN_ACCOUNT = /^\W{1,3}\d{8}(?!\d)/;
const ACCOUNT_THEN_SORT = /(?<!\d)\d{8}\W{1,3}$/;
/** An account at the business itself, not a bank: "patient account 88213441". */
const NOT_A_BANK_ACCOUNT =
  /\b(?:patient|customer|client|member(?:ship)?|loyalty|booking|order)\s*$/i;
const ACCOUNT_WORDS =
  /\b(?:account|acct|acc|a\/c)(?:\s*(?:number|no\.?|num|#))?(?:\s+(?:is|was))?\W{0,6}\d{4}[ -]?\d{4}(?![\d])/gi;

/**
 * An IBAN (which holds a UK sort code and account number) that passes its checksum; a sort code
 * with the words "sort code" before it or an account number directly beside it; or "account
 * number" with 8 digits. A date written like a sort code (`14-10-26`) is common in notes, often
 * near a booking reference, so a bare one doesn't count.
 */
const findBank = (text: string): Span | undefined => {
  for (const m of text.matchAll(IBAN)) {
    const compact = m[0].replace(/ /g, "");
    if (compact.length >= 15 && compact.length <= 34 && ibanValid(compact)) {
      return [m.index, m.index + m[0].length];
    }
  }
  for (const m of text.matchAll(SORT_CODE)) {
    const start = m.index;
    const end = start + m[0].length;
    if (SORT_CODE_WORDS.test(text.slice(Math.max(0, start - 30), start))) return [start, end];
    const after = SORT_THEN_ACCOUNT.exec(text.slice(end, end + 12));
    if (after !== null) return [start, end + after[0].length];
    const before = ACCOUNT_THEN_SORT.exec(text.slice(Math.max(0, start - 12), start));
    if (before !== null) return [start - before[0].length, end];
  }
  for (const m of text.matchAll(ACCOUNT_WORDS)) {
    if (!NOT_A_BANK_ACCOUNT.test(text.slice(Math.max(0, m.index - 20), m.index))) {
      return [m.index, m.index + m[0].length];
    }
  }
  // The words and the number anywhere in the same sentence: "the bank account number for
  // direct debit is 12345678", "sort code for my account is 20.00.00".
  for (const [start, sentence] of sentences(text)) {
    const words = SENTENCE_ACCOUNT_WORDS.exec(sentence);
    if (words !== null && !NOT_A_BANK_ACCOUNT.test(sentence.slice(0, words.index))) {
      const number = ACCOUNT_NUMBER.exec(sentence.slice(words.index));
      if (number !== null)
        return [start + words.index, start + words.index + number.index + number[0].length];
    }
    const sort = SENTENCE_SORT_WORDS.exec(sentence);
    if (sort !== null) {
      const code = LOOSE_SORT_CODE.exec(sentence.slice(sort.index));
      if (code !== null)
        return [start + sort.index, start + sort.index + code.index + code[0].length];
    }
  }
  return undefined;
};

/**
 * The text's sentences, each with its offset. A sentence ends at "!", "?", a line break, or a
 * full stop before a space or the end ("PIN no. 4471" is one sentence).
 */
const sentences = (text: string): [number, string][] => {
  const out: [number, string][] = [];
  let start = 0;
  for (const m of text.matchAll(/[!?\n]|(?<!\bno)\.(?=\s|$)/gi)) {
    out.push([start, text.slice(start, m.index)]);
    start = m.index + 1;
  }
  out.push([start, text.slice(start)]);
  return out;
};

const SENTENCE_ACCOUNT_WORDS = /\b(?:account\s*(?:number|no\b\.?|num\b|#)|acct|a\/c)/i;
/** 8 digits, together or as 4-4 or 2-2-2-2. */
const ACCOUNT_NUMBER = /(?<![\d])\d{2}(?:[ -]?\d{2}){3}(?![\d])/;
const SENTENCE_SORT_WORDS = /\b(?:sort[\s-]*code|s\/c)\b/i;
const LOOSE_SORT_CODE = /(?<![\d])\d{2}[-. –—]?\d{2}[-. –—]?\d{2}(?![\d])/;

/** A secret's name may be followed by "'s": "my PIN's 4471". */
const POSSESSIVE = "(?:['’]s)?";

/** Secrets whose value is a short number: PINs, card security codes, one-time codes. */
const NUMERIC_SECRETS =
  "pin(?:\\s*(?:number|code))?|passcode|cvv2?|cvc|csc|card\\s+security\\s+code|security\\s+code|one[\\s-]*time\\s+(?:pass)?code|otp|verification\\s+code|auth(?:entication)?\\s+code|(?:2fa|mfa|sms|login|access)\\s+code";
const NUMERIC_SECRET = new RegExp(
  `\\b(?:${NUMERIC_SECRETS})\\b${POSSESSIVE}\\W{0,3}(?:(?:is|was|=|:|number|code)\\W{0,3}){0,2}(\\d(?:[ -]?\\d){2,7})(?![\\d])`,
  "gi",
);

/** Secrets whose value is a word or phrase: passwords, memorable words, security answers. */
const WORD_SECRETS =
  "first\\s+pet(?:['’]?s\\s+name)?|place\\s+of\\s+birth|first\\s+school|passcode|password|passphrase|pass\\s*word|passwd|pwd|pw|memorable\\s+(?:word|information|info|answer|place|date|name)|(?:mother'?s|mum'?s|mom'?s)\\s+maiden\\s+name|maiden\\s+name|security\\s+answer|secret\\s+answer|answer\\s+to\\s+(?:my|the)\\s+security\\s+question|security\\s+question\\s+answer";
/**
 * The name, then a joiner, then the value, perhaps quoted. The joiner is ":", "=", "->" or a dash
 * (group 1), or "is", "was" or "is set to" (group 2), or just whitespace. Each alternative takes
 * its whitespace once, so a long run of spaces can't make the match backtrack.
 */
const WORD_SECRET = new RegExp(
  `\\b(?:${WORD_SECRETS})\\b${POSSESSIVE}(?:[ \\t]{0,10}(:|=|->|[-–—]+)\\s{0,10}|\\s+(?:(is\\s+set\\s+to|is|was)\\s+)?)(["'“‘]?)([^\\s"'”’.,;!?]{2,})`,
  "gi",
);

/**
 * A word secret's name, then up to 40 characters of the same sentence, then "it's", "it is",
 * "tell them", "say", "is", "was", ":" or "=", then the value (group 2) and what follows it.
 */
const DISTANT_WORD_SECRET = new RegExp(
  `\\b(?:${WORD_SECRETS})\\b[^.!?\\n]{0,40}?(?:\\b(?:it['’]?s|it\\s+is|tell\\s+them|say|is|was)\\s+|[:=]\\s*)(["'“‘]?)([^\\s"'”’.,;!?]{2,})(.{0,2})`,
  "gi",
);

/** Words that start an instruction or a clause after "password:", not an answer. */
const NOT_AN_ANSWER = new Set(
  (
    "say says tell ask hang call just dont don't refuse decline explain leave skip ignore " +
    "they them you your he she we us i i'll ill it its it's we'll they'll can't cant won't wont " +
    "to do does please use see check need needs have has should will would could can may might " +
    "only still also then later"
  ).split(" "),
);

/** Secrets whose answers are ordinary words, so a bare word after them is a value. */
const PLAIN_WORD_SECRETS =
  /^(?:first\s+pet|place\s+of\s+birth|first\s+school|memorable|mother|mum|mom|maiden|security|secret|answer)/i;

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
  "see",
  "ask",
  "check",
  "still",
  "being",
  "going",
  "to",
  "changed",
  "reset",
  "expired",
  "locked",
  "too",
  "incorrect",
  "invalid",
  "weak",
  "strong",
  "case",
  "sensitive",
  "sent",
  "forgotten",
  "fine",
  "none",
  "n/a",
  "prompt",
  "hard",
  "easy",
  "long",
  "short",
  "different",
]);

/**
 * Words that follow a secret's name directly ("password reset", "password manager") without
 * being its value. Only for the bare form with no ":" or "is" between them.
 */
const NOT_A_BARE_VALUE = new Set([
  // A joiner whose value was too short to count ("memorable word is a secret").
  "is",
  "was",
  "set",
  "reset",
  "manager",
  "link",
  "field",
  "box",
  "change",
  "changes",
  "policy",
  "rules",
  "requirements",
  "hint",
  "protected",
  "and",
  "or",
  "but",
  "if",
  "so",
  "please",
  "will",
  "can",
  "could",
  "should",
  "has",
  "had",
  "have",
  "needs",
  "need",
  "again",
  "question",
  "questions",
  "email",
  "letter",
  "they",
  "you",
  "i",
  "we",
  "from",
  "with",
  "by",
  // Words cut at an apostrophe: "the password doesn't work".
  "doesn",
  "isn",
  "wasn",
  "don",
  "won",
  "didn",
  "aren",
  "can",
]);

/** A numeric secret's name anywhere in a sentence. */
const NUMERIC_SECRET_NAME = new RegExp(`\\b(?:${NUMERIC_SECRETS})\\b`, "i");
/**
 * A PIN-like number: 3–8 digits on their own, not part of a date, time, price, phone number or
 * longer group, and not a count ("6 digits", "10 minutes").
 */
const PIN_LIKE =
  /(?<![\d/:.,+£$€]|\d[ -])\d{3,8}(?![\d/:]|[.,]\d|[ -]\d|\s*(?:digits?|minutes?|mins?|hours?|am|pm|%))/;

const findSecretValue = (text: string): Span | undefined => {
  for (const m of text.matchAll(NUMERIC_SECRET)) return [m.index, m.index + m[0].length];
  // A PIN and a number in the same sentence, in any order: "if they ask for my PIN, it's 4471",
  // "4471 is my PIN". A bare mention ("they may ask for a PIN") has no number, so it passes.
  for (const [start, sentence] of sentences(text)) {
    const name = NUMERIC_SECRET_NAME.exec(sentence);
    const value = name === null ? null : PIN_LIKE.exec(sentence);
    if (name !== null && value !== null) {
      const from = Math.min(name.index, value.index);
      const to = Math.max(name.index + name[0].length, value.index + value[0].length);
      return [start + from, start + to];
    }
  }
  for (const m of text.matchAll(WORD_SECRET)) {
    const [, symbol, word, quote, token] = m as unknown as [
      string,
      string | undefined,
      string | undefined,
      string,
      string,
    ];
    const joiner = symbol ?? word ?? "";
    const value = token.toLowerCase();
    // A quoted value is a value, even if it's an ordinary word ("correct horse").
    if (quote !== "") return [m.index, m.index + m[0].length];
    if (NOT_A_VALUE.has(value)) continue;
    // "memorable word: tell them to call me": after ":" or a dash, an instruction isn't a value.
    if (symbol !== undefined && !/[\d\W_]/.test(value) && NOT_AN_ANSWER.has(value)) continue;
    // With nothing between name and value, the value must look like one: "password hunter2",
    // but not "password recovery". Answers to memorable-word and security questions are plain
    // words, so "first pet Rex" and "memorable word sunshine" count.
    if (joiner === "") {
      if (NOT_A_BARE_VALUE.has(value)) continue;
      const plainWordAnswer = PLAIN_WORD_SECRETS.test(m[0]);
      if (!plainWordAnswer && !/[\d\W_]/.test(value)) continue;
    }
    return [m.index, m.index + m[0].length];
  }
  // The value later in the same sentence: "if they ask for the password, it's hunter2", "my
  // password for the portal is hunter2", "the memorable word they have is sunshine".
  for (const m of text.matchAll(DISTANT_WORD_SECRET)) {
    const [, quote, token, after] = m as unknown as [string, string, string, string];
    const value = token.toLowerCase();
    if (quote !== "") return [m.index, m.index + m[0].length];
    if (NOT_A_VALUE.has(value) || NOT_AN_ANSWER.has(value)) continue;
    const looksLikeOne = /[\d\W_]/.test(value);
    // A plain word counts for the plain-word secrets, when it ends the clause.
    const plainAnswer =
      PLAIN_WORD_SECRETS.test(m[0].replace(/^\W+/, "")) && /^\s*(?:[.,;!?]|$)/.test(after);
    if (looksLikeOne || plainAnswer) return [m.index, m.index + m[0].length];
  }
  return undefined;
};

/**
 * `ok` with the normalised text when nothing matches; otherwise the first kind found (cards,
 * then bank details, then keyword values) and where it is.
 */
export const rejectSecrets = (
  text: string,
): Result<string, SecretReason, { readonly span: Span }> => {
  if (text.length > MAX_SCAN_LENGTH) return err("too_long", { span: [0, text.length] });
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

/** Street words people abbreviate, so "12 High St" matches "12 High Street". */
const STREET_WORDS: Readonly<Record<string, string>> = {
  street: "st",
  road: "rd",
  avenue: "ave",
  lane: "ln",
  drive: "dr",
  close: "cl",
  crescent: "cres",
  place: "pl",
  square: "sq",
  gardens: "gdns",
  terrace: "ter",
};

/** NFKC, case-folded, every run of anything but letters and digits collapsed to one space. */
const fold = (text: string): string =>
  normaliseForScan(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .map((w) => STREET_WORDS[w] ?? w)
    .join(" ");

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
  const out = new Set<string>([`${y}${mm}${dd}`, `${dd}${mm}${y}`, `${dd}${mm}${y.slice(2)}`]);
  for (const d of days) {
    for (const mo of months) {
      for (const yr of years) {
        out.add(`${d} ${mo} ${yr}`);
        out.add(`${d} of ${mo} ${yr}`);
        out.add(`${mo} ${d} ${yr}`);
        out.add(`${yr} ${mo} ${d}`);
      }
    }
  }
  return [...out];
};

const digitsOnly = (text: string): string => normaliseForScan(text).replace(/\D/g, "");

/**
 * Fields that aren't matched: `existing_patient` holds no value worth matching, and a preferred
 * name is usually the first name the Brief already carries (`forPerson.firstName`), which a
 * note may use freely.
 */
const SKIP: ReadonlySet<ProfileField> = new Set(["existing_patient", "preferred_name"]);

export const PROFILE_VALUE_REASONS = ["profile_value", "too_long"] as const;
export type ProfileValueReason = (typeof PROFILE_VALUE_REASONS)[number];

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * `ok` unless `text` contains one of the user's own profile values, in any usual spelling. The
 * web server calls it at draft time with the user's values, before a Brief revision is written.
 * Values of three characters or fewer are ignored: they'd match by accident. Numbers must be a
 * whole span of digit groups in the note, and words match whole words, so a longer reference or
 * a neighbouring postcode doesn't trip it.
 */
export const rejectProfileValues = (
  text: string,
  values: ProfileValues,
  /** The Brief's `forPerson.firstName`: a note may use it, so a value equal to it isn't matched. */
  firstName?: string,
): Result<true, ProfileValueReason, { readonly field?: ProfileField }> => {
  if (text.length > MAX_SCAN_LENGTH) return err("too_long", {});
  const words = ` ${fold(text)} `;
  const spans = new Set(digitSpans(normaliseForScan(text)).map((s) => s.digits));
  const contains = (phrase: string): boolean => phrase !== "" && words.includes(` ${phrase} `);
  for (const [field, raw] of Object.entries(values) as [ProfileField, string | undefined][]) {
    if (raw === undefined || SKIP.has(field) || fold(raw).replace(/ /g, "").length <= 3) continue;
    if (firstName !== undefined && fold(raw) === fold(firstName)) continue;
    let hit: boolean;
    switch (field) {
      case "date_of_birth":
        hit = dateSpellings(raw).some(contains);
        break;
      case "postcode": {
        const compact = fold(raw).replace(/ /g, "");
        const outward = escapeRegExp(compact.slice(0, -3));
        const inward = escapeRegExp(compact.slice(-3));
        hit = new RegExp(` ${outward} ?${inward} `).test(words);
        break;
      }
      case "contact_phone":
      case "nhs_number": {
        const digits = digitsOnly(raw);
        // +44 spellings apply to phone numbers only: an NHS number is always its 10 digits.
        const national = field === "contact_phone" ? digits.replace(/^44/, "0") : digits;
        const variants =
          field === "contact_phone"
            ? [national, national.replace(/^0/, "44"), national.replace(/^0/, "")]
            : [national];
        hit = national.length >= 7 && variants.some((v) => spans.has(v));
        break;
      }
      default:
        hit = contains(fold(raw));
    }
    if (hit) return err("profile_value", { field });
  }
  return ok(true);
};
