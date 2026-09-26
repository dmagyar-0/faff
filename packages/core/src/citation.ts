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

/** Runs of text that could be one phone number: digits with the usual separators. */
const PHONE_RUN = /(?:\+|\b)\d[\d\s().\-/]{5,}\d/g;
const EMAIL_RUN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const phonesIn = (text: string): E164[] => {
  const out: E164[] = [];
  for (const m of text.matchAll(PHONE_RUN)) {
    const e164 = normalisePhone(m[0]);
    if (e164 !== null) out.push(e164);
  }
  return out;
};

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
 * `ok` when the normalised quote appears in the normalised page **and** the candidate appears in
 * the quote: a phone as the E.164 of some phone-like run in the quote, an email as an address in
 * the quote with the same local part and the same domain ignoring case.
 */
export const citationHolds = (
  candidate: CitationCandidate,
  quote: string,
  pageText: string,
): Result<true, CitationReason> => {
  const q = normaliseText(quote);
  if (q === "") return err("empty_quote");
  if (!normaliseText(pageText).includes(q)) return err("quote_not_on_page");
  const found =
    candidate.phone !== undefined
      ? phonesIn(q).includes(candidate.phone)
      : [...q.matchAll(EMAIL_RUN)].some((m) => sameEmail(m[0], candidate.email));
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
 * Q39 condition 4: the evidence page names the business (every word of its display name appears
 * on the page) **and** matches its postcode (spaces and case ignored) or its address (every word
 * of it appears, in order).
 */
export const pageNamesBusiness = (
  pageText: string,
  business: { readonly displayName: string; readonly postcode?: string; readonly address?: string },
): Result<true, PageNamesReason> => {
  const page = ` ${fold(pageText)} `;
  const nameWords = fold(business.displayName)
    .split(" ")
    .filter((w) => w !== "");
  if (nameWords.length === 0 || !nameWords.every((w) => page.includes(` ${w} `))) {
    return err("name_not_on_page");
  }
  const postcode = business.postcode === undefined ? "" : fold(business.postcode).replace(/ /g, "");
  const address = business.address === undefined ? "" : fold(business.address);
  const postcodeOk = postcode !== "" && page.replace(/ /g, "").includes(postcode);
  const addressOk = address !== "" && page.includes(` ${address} `);
  return postcodeOk || addressOk ? ok(true) : err("location_not_on_page");
};

/** The host of an http(s) URL, lowercase, without a trailing dot; `undefined` if there isn't one. */
export const hostOf = (url: string): string | undefined => {
  const m = /^https?:\/\/(?:[^@/?#]*@)?([^:/?#\\]+)(?::\d+)?(?:[/?#]|$)/i.exec(url.trim());
  const host = m?.[1]?.toLowerCase().replace(/\.$/, "");
  return host === undefined || host === "" ? undefined : host;
};

/** "https://www.Smile.example/contact", "www.smile.example" or "smile.example" → "smile.example". */
export const domainOf = (site: string): string | undefined => {
  const host = /^https?:\/\//i.test(site) ? hostOf(site) : hostOf(`https://${site}`);
  return host?.replace(/^www\./, "");
};

const onDomain = (host: string, domain: string): boolean =>
  host === domain || host.endsWith(`.${domain}`);

/**
 * Q39 condition 2: the evidence URL is on the business's own domain (`businesses.website`, G20)
 * or a directory the locale trusts (the NHS service directory in en-GB). Third-party directories
 * don't count.
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
  return trustedDirectories.some((d) => onDomain(host, d.toLowerCase()));
};
