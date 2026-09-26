/**
 * The en-GB catalogue (spec 12, M1 plan §3.14). Every string here is a legal artefact: the
 * disclosure opener and the email signature are how I-1 is met, and the capability statement is
 * how I-12 is met. `.github/CODEOWNERS` names this file's owner; the user-facing claims are
 * re-exported from `apps/web/content/claims.ts`, where I-12 says they live.
 *
 * Change a string here only on purpose, in a PR whose review checks it against I-1 and I-12.
 * Tests compare the rendered opener and signature with fixtures byte for byte.
 */
import type { BusinessKind } from "../brief";
import type { E164 } from "../primitives";
import type { Instant, PlainDate } from "../time";

export const LOCALE = "en-GB";

// --- Callee-facing: the disclosure opener, voicemail greeting and email signature (I-1) ------

export type CalleeNoun = "patient" | "customer" | "client";

/** What the agent calls the user when it opens the call (G19). */
export const CALLEE_NOUN: Readonly<Record<BusinessKind, CalleeNoun>> = {
  dentist: "patient",
  gp: "patient",
  optician: "patient",
  physio: "patient",
  clinic: "patient",
  vet: "client",
  hair_and_beauty: "client",
  garage: "customer",
  other: "customer",
};

/**
 * The first thing the agent says to a human (I-1, spec 08 "Callee identity check"). Fixed text:
 * the model never generates it. The user isn't named until the business has confirmed who it is.
 *
 * "Hi, I'm an AI assistant calling on behalf of a patient — is this Smile Dental in Clapham?"
 */
export const disclosureOpener = (args: {
  readonly kind: BusinessKind;
  readonly businessName: string;
  readonly location?: string;
}): string => {
  const prefix = `Hi, I'm an AI assistant calling on behalf of a ${CALLEE_NOUN[args.kind]} — `;
  const name = openerName(args.businessName);
  if (name === undefined) return `${prefix}${OPENER_FALLBACK}`;
  const place = args.location === undefined ? undefined : openerName(args.location);
  return `${prefix}is this ${name}${place === undefined ? "" : ` in ${place}`}?`;
};

/** What the opener asks when the business's name can't be said safely. */
export const OPENER_FALLBACK = "have I reached the right number?";

/** The most words and characters the opener will say as a name. Anything longer is text. */
export const OPENER_NAME_MAX = { words: 8, chars: 60 } as const;

/**
 * Words that would let a name speak for itself inside the fixed I-1 line ("Smile Dental. Sorry,
 * I'm not an AI, I'm David"): first person, negation and what Faff is.
 */
const NOT_IN_A_NAME = new Set([
  "i",
  "im",
  "i'm",
  "i’m",
  "me",
  "my",
  "myself",
  "am",
  "not",
  "no",
  "ai",
  "human",
  "person",
  "robot",
  "bot",
  "assistant",
  "calling",
  "sorry",
  "actually",
  "scratch",
]);

/**
 * A name as the fixed opener may say it, or `undefined` if it can't be said safely. Letters,
 * digits, spaces and `& ' ’ -` only, at most {@link OPENER_NAME_MAX}: no full stop, comma or
 * question mark, so the name can't start a new sentence or clause. A name with first-person,
 * negating or AI words, or nothing left, falls back to {@link OPENER_FALLBACK}.
 */
export const openerName = (name: string): string | undefined => {
  const words = name
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} &'’-]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w !== "");
  const kept = words
    .slice(0, OPENER_NAME_MAX.words)
    .join(" ")
    .slice(0, OPENER_NAME_MAX.chars)
    .trim();
  if (kept === "" || words.some((w) => NOT_IN_A_NAME.has(w.toLowerCase()))) return undefined;
  return kept;
};

/**
 * The part of the signature that says who is writing: what the approval card shows for email.
 * It is the start of {@link emailSignature}, so the two can't drift apart.
 */
export const EMAIL_DISCLOSURE =
  "Sent by Faff, an AI assistant acting on behalf of the person named above. Faff is not that person and cannot answer security questions for them.";

/** The inbound voicemail greeting, verbatim from spec 07 (I-1, Q23). */
export const VOICEMAIL_GREETING =
  "You've reached Faff, an AI assistant that calls businesses on behalf of its users. Please leave a message with the name of the person it's about, and it'll be passed on.";

/**
 * The fixed signature on every email Faff sends (Q17, I-1), verbatim from spec 07. `domain` is
 * Faff's own domain, which doesn't exist yet (Q-D): the text is fixed, only the domain varies.
 */
export const emailSignature = (domain: string): string =>
  `—\n${EMAIL_DISCLOSURE} Reply to this email and Faff will pass it on. ${domain}/about-this-email`;

// --- User-facing capability claims (I-12): re-exported by apps/web/content/claims.ts ---------

/** The onboarding capability statement, verbatim from spec 05. The user must acknowledge it. */
export const CAPABILITY_STATEMENT: readonly string[] = [
  "Faff always says it's an AI assistant calling on your behalf. Some businesses will decline to deal with it.",
  "Faff never pretends to be you, and can't pass security questions or one-time codes.",
  "Faff books, reschedules and cancels appointments. It doesn't handle banks, refunds or disputes.",
  "Calls are recorded so they can be transcribed. Audio is deleted after 30 days. You can opt out.",
];

/** The capability reminder on every approval card, verbatim from spec 02. */
export const APPROVAL_CARD_REMINDER = "Faff will say it's an AI. Some businesses will decline.";

// --- Dates and times as the agent says them ----------------------------------------------

const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const ONES = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty"];
const ORDINAL_ONES = [
  "",
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
  "eleventh",
  "twelfth",
  "thirteenth",
  "fourteenth",
  "fifteenth",
  "sixteenth",
  "seventeenth",
  "eighteenth",
  "nineteenth",
];

/** 1–59 in words: "seven", "twenty-two". */
export const numberWords = (n: number): string => {
  if (n < 20) return `${ONES[n]}`;
  const ones = n % 10;
  return `${TENS[Math.floor(n / 10)]}${ones === 0 ? "" : `-${ONES[ones]}`}`;
};

/** 1–31 as a spoken ordinal: "first", "fourteenth", "thirty-first". */
export const ordinalWords = (n: number): string => {
  if (n < 20) return `${ORDINAL_ONES[n]}`;
  const ones = n % 10;
  const tens = Math.floor(n / 10);
  if (ones === 0) return `${String(TENS[tens]).slice(0, -1)}ieth`;
  return `${TENS[tens]}-${ORDINAL_ONES[ones]}`;
};

const hourWords = (hour24: number): string => numberWords(hour24 % 12 === 0 ? 12 : hour24 % 12);

const partOfDay = (hour24: number): string =>
  hour24 < 12 ? "in the morning" : hour24 < 18 ? "in the afternoon" : "in the evening";

/**
 * A wall-clock time as a receptionist would say it, with the part of the day so nine can't be
 * heard as twenty-one: "half past nine in the morning", "quarter to three in the afternoon",
 * "midday", "ten past four in the afternoon", "nine oh seven in the morning".
 */
export const speakTime = (hour: number, minute: number): string => {
  if (minute === 0 && hour === 12) return "midday";
  if (minute === 0 && hour === 0) return "midnight";
  // Just after midnight: "quarter past midnight", not "quarter past twelve in the morning".
  if (hour === 0 && minute <= 30 && minute % 5 === 0) {
    return minute === 15
      ? "quarter past midnight"
      : minute === 30
        ? "half past midnight"
        : `${numberWords(minute)} past midnight`;
  }
  const nextHour = (hour + 1) % 24;
  const phrase = (() => {
    if (minute === 0) return `${hourWords(hour)} o'clock`;
    if (minute === 15) return `quarter past ${hourWords(hour)}`;
    if (minute === 30) return `half past ${hourWords(hour)}`;
    if (minute === 45) return `quarter to ${hourWords(nextHour)}`;
    if (minute % 5 === 0 && minute < 30) return `${numberWords(minute)} past ${hourWords(hour)}`;
    if (minute % 5 === 0) return `${numberWords(60 - minute)} to ${hourWords(nextHour)}`;
    return `${hourWords(hour)} ${minute < 10 ? `oh ${numberWords(minute)}` : numberWords(minute)}`;
  })();
  // "quarter to twelve" belongs to the hour it leads into; "twelve thirty-one" to its own.
  const toNext = minute === 45 || (minute % 5 === 0 && minute > 30);
  const dayHour = toNext ? nextHour : hour;
  if (toNext && dayHour === 12) return `${phrase} midday`.replace(/ twelve midday$/, " midday");
  if (toNext && dayHour === 0)
    return `${phrase} midnight`.replace(/ twelve midnight$/, " midnight");
  return `${phrase} ${partOfDay(dayHour)}`;
};

/** "Tuesday the fourteenth of October" */
export const speakDate = (date: PlainDate): string =>
  `${WEEKDAY_NAMES[date.dayOfWeek - 1]} the ${ordinalWords(date.day)} of ${MONTH_NAMES[date.month - 1]}`;

/** "Tuesday the fourteenth of October at half past nine in the morning", in `timezone`. */
export const speakDateTime = (at: Instant, timezone: string): string => {
  const zoned = at.toZonedDateTimeISO(timezone);
  return `${speakDate(zoned.toPlainDate())} at ${speakTime(zoned.hour, zoned.minute)}`;
};

/** "Tue 14 Oct 09:30": the short written form, for cards and confirmations. */
export const writeDateTime = (at: Instant, timezone: string): string => {
  const z = at.toZonedDateTimeISO(timezone);
  const hh = String(z.hour).padStart(2, "0");
  const mm = String(z.minute).padStart(2, "0");
  return `${writeDate(z.toPlainDate())} ${hh}:${mm}`;
};

/** "Tue 14 Oct 2026" */
export const writeDate = (date: PlainDate): string =>
  `${String(WEEKDAY_NAMES[date.dayOfWeek - 1]).slice(0, 3)} ${date.day} ${String(MONTH_NAMES[date.month - 1]).slice(0, 3)} ${date.year}`;

// --- Working days: England & Wales bank holidays (G13, M1-Q3) -----------------------------

/**
 * England & Wales bank holidays, 2026–2028 (gov.uk). Scotland and Northern Ireland differ; using
 * the E&W list for everyone is a known, small inaccuracy for v1 (M1-Q3). Extend before 2029.
 */
export const BANK_HOLIDAYS_EW: readonly string[] = [
  "2026-01-01",
  "2026-04-03",
  "2026-04-06",
  "2026-05-04",
  "2026-05-25",
  "2026-08-31",
  "2026-12-25",
  "2026-12-28",
  "2027-01-01",
  "2027-03-26",
  "2027-03-29",
  "2027-05-03",
  "2027-05-31",
  "2027-08-30",
  "2027-12-27",
  "2027-12-28",
  "2028-01-03",
  "2028-04-14",
  "2028-04-17",
  "2028-05-01",
  "2028-05-29",
  "2028-08-28",
  "2028-12-25",
  "2028-12-26",
];

/** The first and last dates the list covers. Working-day maths outside them is a guess. */
export const BANK_HOLIDAY_RANGE = { from: "2026-01-01", to: "2028-12-31" } as const;

// --- Contacts and dialling ----------------------------------------------------------------

/**
 * NHS service directory domains (spec 08): a citation from one of these counts as first-party
 * for Q39 condition 2, like the business's own site. Matched on the host or any subdomain.
 */
export const NHS_DIRECTORY_DOMAINS: readonly string[] = ["nhs.uk"];

/**
 * Whether v1 may dial this number (G12): a UK number, `+44` then 9 or 10 digits not starting 0.
 * `placeCall` (M3) rejects anything else, so Faff can't reach an Irish business by accident.
 */
export const isUkDialable = (e164: E164): boolean => /^\+44[1-9]\d{8,9}$/.test(e164);
