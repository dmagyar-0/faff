/**
 * The pure half of `verifyCitation` (I-11, Q31, M1 plan §3.10). The fetching half lives in
 * `agents/lookup` (M7): it re-fetches the page, turns it into text and calls these. Faff never
 * dials a number or emails an address from the web unless the exact string appears in a quote
 * that appears on the page. No LLM is involved.
 *
 * Obfuscated addresses (`info [at] example.com`) fail on purpose: I-11 would rather discard a
 * real address than use one the page didn't literally say.
 */
import type { E164 } from "./primitives";
import { err, ok, type Result } from "./result";

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;
const DASHES = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;
const SINGLE_QUOTES = /[\u2018\u2019\u201A\u201B\u2032]/g;
const DOUBLE_QUOTES = /[\u201C\u201D\u201E\u201F\u2033]/g;

/**
 * NFKC; zero-width characters and soft hyphens removed; every run of whitespace (NBSP, line
 * breaks, tabs) collapsed to one space; dashes and curly quotes unified; trimmed.
 */
export const normaliseText = (text: string): string =>
  text
    .normalize("NFKC")
    .replace(ZERO_WIDTH, "")
    .replace(DASHES, "-")
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(/\s+/g, " ")
    .trim();

/**
 * A written phone number as E.164, or `null` if it can't be one. `+44 20 7946 0000`,
 * `020 7946 0000`, `(020) 7946-0000`, `+44 (0)20 7946 0000` and `0044 20 7946 0000` all give
 * `+442079460000`. A national number (leading 0) is read in `defaultRegion`; only GB is known.
 */
export const normalisePhone = (text: string, defaultRegion: "GB" = "GB"): E164 | null => {
  const t = normaliseText(text);
  if (!/^[+(\d][\d\s().\-/]*\d$/.test(t)) return null;
  // "+44 (0)20…": the (0) is the national prefix, written for people dialling from inside the UK.
  const cleaned = t.replace(/^(\+|00)(\d{1,3})\s*\(0\)/, "$1$2").replace(/[^\d+]/g, "");
  let digits: string;
  if (cleaned.startsWith("+")) digits = cleaned.slice(1);
  else if (cleaned.startsWith("00")) digits = cleaned.slice(2);
  else if (defaultRegion === "GB" && /^0[1-9]\d{8,9}$/.test(cleaned))
    digits = `44${cleaned.slice(1)}`;
  else return null;
  if (digits.includes("+") || !/^[1-9]\d{6,14}$/.test(digits)) return null;
  if (digits.startsWith("44") && !/^44[1-9]\d{8,9}$/.test(digits)) return null;
  return `+${digits}`;
};

/** Digit groups separated by the characters phone numbers are written with. */
const DIGIT_RUN = /\d(?:[\s().\-/]*\d)*/g;
const EMAIL_RUN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

type Occurrence = readonly [number, number];

/** Every place `needle` appears in `haystack`, as [start, end). */
const occurrencesOf = (haystack: string, needle: string): Occurrence[] => {
  const out: Occurrence[] = [];
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
    out.push([at, at + needle.length]);
  }
  return out;
};

const inside = (start: number, end: number, spans: readonly Occurrence[]): boolean =>
  spans.some(([s, e]) => s <= start && end <= e);

/**
 * Whether `phone` is written on the page, inside the quote, as a whole: the text of some span of
 * whole digit groups (with a "+" written just before it) normalises to exactly `phone`. The text
 * must say the whole number, so "+44 20 7946 0000" can't vouch for "+2079460000" (a span that
 * drops the country code has no "+" and no leading 0), and whole groups mean a number can't be
 * cut out of the middle of one ("020 7946 00001234" doesn't contain 020 7946 0000). A number
 * followed by an extension written as its own group ("020 7946 0000 1234") does count.
 */
const phoneOnPage = (phone: E164, page: string, quotes: readonly Occurrence[]): boolean => {
  for (const m of page.matchAll(DIGIT_RUN)) {
    const groups = [...m[0].matchAll(/\d+/g)].map((g) => ({
      start: m.index + g.index,
      end: m.index + g.index + g[0].length,
      length: g[0].length,
    }));
    for (let i = 0; i < groups.length; i++) {
      const first = groups[i] as (typeof groups)[number];
      const start = page[first.start - 1] === "+" ? first.start - 1 : first.start;
      let digits = 0;
      // No phone number, in any spelling, has more than 19 digits: stop there, so a long run of
      // digits costs linear time.
      for (let j = i; j < groups.length && digits <= 19; j++) {
        const g = groups[j] as (typeof groups)[number];
        digits += g.length;
        if (normalisePhone(page.slice(start, g.end)) === phone && inside(start, g.end, quotes)) {
          return true;
        }
      }
    }
  }
  return false;
};

/**
 * Whether `email` is written on the page, inside the quote, as a whole address: a maximal
 * address-shaped run, so "info@…" can't be cut out of "notinfo@…" nor "…co" out of "…co.uk".
 */
const emailOnPage = (email: string, page: string, quotes: readonly Occurrence[]): boolean =>
  [...page.matchAll(EMAIL_RUN)].some((m) => {
    const before = page[m.index - 1] ?? " ";
    const after = page[m.index + m[0].length] ?? " ";
    // A "." or "-" after it only continues the address if more of an address follows:
    // "Email bookings@smile.example." ends a sentence.
    const next = page[m.index + m[0].length + 1] ?? " ";
    const continues = /[A-Za-z0-9]/.test(after) || (/[.-]/.test(after) && /[A-Za-z0-9]/.test(next));
    const whole = !/[A-Za-z0-9._%+-]/.test(before) && !continues;
    return whole && sameEmail(m[0], email) && inside(m.index, m.index + m[0].length, quotes);
  });

/** Emails are equal when the local part matches exactly and the domain ignoring case. */
export const sameEmail = (a: string, b: string): boolean => {
  const [la, da] = splitEmail(a);
  const [lb, db] = splitEmail(b);
  return la === lb && da.toLowerCase() === db.toLowerCase() && da !== "";
};

const splitEmail = (email: string): [string, string] => {
  const at = email.lastIndexOf("@");
  return at < 0 ? [email, ""] : [email.slice(0, at), email.slice(at + 1)];
};

export type CitationCandidate =
  | { readonly phone: E164; readonly email?: undefined }
  | { readonly email: string; readonly phone?: undefined };

export const CITATION_REASONS = ["quote_not_on_page", "value_not_in_quote", "empty_quote"] as const;
export type CitationReason = (typeof CITATION_REASONS)[number];

/**
 * `ok` when the normalised quote appears in the normalised page **and** the candidate is written,
 * whole, inside it: a phone as a whole span of digit groups spelling its number (+44, 0044, 0 or
 * +44 (0) forms); an email as a whole address with the same local part and the same domain
 * ignoring case. The value is looked for on the page, not just in the quote, so a quote that cuts
 * a longer number or address in half can't vouch for the half.
 */
export const citationHolds = (
  candidate: CitationCandidate,
  quote: string,
  pageText: string,
): Result<true, CitationReason> => {
  const q = normaliseText(quote);
  if (q === "") return err("empty_quote");
  const page = normaliseText(pageText);
  const quotes = occurrencesOf(page, q);
  if (quotes.length === 0) return err("quote_not_on_page");
  const found =
    candidate.phone !== undefined
      ? phoneOnPage(candidate.phone, page, quotes)
      : emailOnPage(candidate.email, page, quotes);
  return found ? ok(true) : err("value_not_in_quote");
};

const fold = (text: string): string =>
  normaliseText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export const PAGE_NAMES_REASONS = ["name_not_on_page", "location_not_on_page"] as const;
export type PageNamesReason = (typeof PAGE_NAMES_REASONS)[number];

/**
 * Q39 condition 4: the evidence page names the business (the part of its display name before any
 * comma appears as one phrase) **and** has its postcode (as whole words, case and the space
 * ignored) or its address (as one phrase).
 */
export const pageNamesBusiness = (
  pageText: string,
  business: { readonly displayName: string; readonly postcode?: string; readonly address?: string },
): Result<true, PageNamesReason> => {
  const page = ` ${fold(pageText)} `;
  // The name as one phrase: the part before the display name's comma ("Smile Dental, Clapham").
  const name = fold(business.displayName.split(",", 1).join(""));
  if (name === "" || !page.includes(` ${name} `)) return err("name_not_on_page");
  const postcode = business.postcode === undefined ? "" : fold(business.postcode).replace(/ /g, "");
  const address = business.address === undefined ? "" : fold(business.address);
  // The postcode as whole words: its outward and inward parts, with or without the space.
  const postcodeOk =
    postcode.length > 3 &&
    (page.includes(` ${postcode.slice(0, -3)} ${postcode.slice(-3)} `) ||
      page.includes(` ${postcode} `));
  const addressOk = address !== "" && page.includes(` ${address} `);
  return postcodeOk || addressOk ? ok(true) : err("location_not_on_page");
};

/** The host of an http(s) URL, lowercase, without a trailing dot; `undefined` if there isn't one. */
export const hostOf = (url: string): string | undefined => {
  // Browsers read "\" as "/" and "user@host" as host, so a URL with either, or with whitespace
  // or control characters, could name one host here and fetch another: no host at all.
  if (/[\\@\s\p{Cc}]/u.test(url)) return undefined;
  const m = /^https?:\/\/([^:/?#]+)(?::\d+)?(?:[/?#]|$)/i.exec(url);
  const host = m?.[1]?.toLowerCase().replace(/\.$/, "");
  return host === undefined || host === "" ? undefined : host;
};

/** "https://www.Smile.example/contact", "www.smile.example" or "smile.example" → "smile.example". */
export const domainOf = (site: string): string | undefined => {
  const url = /^https?:\/\//i.test(site) ? site : `https://${site}`;
  // A site with a path ("facebook.com/smiledental") isn't a domain the business owns: counting it
  // would make the whole host first-party.
  if (/^https?:\/\/[^/?#]*[/?#]./i.test(url)) return undefined;
  return hostOf(url)?.replace(/^www\./, "");
};

const onDomain = (host: string, domain: string): boolean =>
  host === domain || host.endsWith(`.${domain}`);

/**
 * Q39 condition 2: the evidence URL is on the business's own domain (`businesses.website`, G20)
 * or on a directory host the locale trusts, matched exactly (the NHS service directory,
 * `www.nhs.uk`, in en-GB). Third-party directories don't count.
 */
export const isFirstPartySource = (
  url: string,
  businessWebsite: string | undefined,
  trustedDirectories: readonly string[],
): boolean => {
  const host = hostOf(url);
  if (host === undefined) return false;
  const own = businessWebsite === undefined ? undefined : domainOf(businessWebsite);
  if (own !== undefined && onDomain(host, own)) return true;
  // Directories are exact hosts (www.nhs.uk): other nhs.uk subdomains are practices and trusts,
  // whose pages can list several businesses.
  return trustedDirectories.some((d) => host === d.toLowerCase());
};
