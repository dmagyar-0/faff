/**
 * `mayAutoSwitchContact` (Q39, spec 08 "After a wrong number", M1 plan §3.11): after a wrong
 * number, may Faff dial the newly resolved contact without a new approval? Only when code can
 * vouch for it. The six conditions are checked in spec 08's order and each failure has its own
 * reason code, so the escalation can say which one failed. This is an I-3 guard: the Brief
 * pre-authorises exactly this rule and nothing wider.
 */
import type { Brief } from "./brief";
import { citationHolds, isFirstPartySource, pageNamesBusiness } from "./citation";
import type { ResolvedContact } from "./contact";
import type { Observation } from "./observations";
import type { E164 } from "./primitives";
import { err, ok, type Result } from "./result";

export const CONTACT_SWITCH_REASONS = [
  "auto_switch_disabled",
  "no_new_number",
  "same_number",
  "source_not_trusted",
  "citation_failed",
  "known_wrong_number",
  "page_does_not_name_business",
  "already_switched",
  "limits_exhausted",
] as const;
export type ContactSwitchReason = (typeof CONTACT_SWITCH_REASONS)[number];

export type ContactSwitchInput = {
  readonly brief: Brief;
  /** How many times this task has already switched contact automatically. */
  readonly autoSwitchesSoFar: number;
  /** The contact resolution found after the wrong number. */
  readonly newContact: ResolvedContact;
  /** The number that turned out to be wrong. */
  readonly failedPhone: E164;
  /** This business's observations. */
  readonly observations: readonly Observation[];
  /** The `businesses` row: identity, and the website G20 adds. */
  readonly business: {
    readonly businessId: string;
    readonly displayName: string;
    readonly postcode?: string;
    readonly address?: string;
    readonly website?: string;
  };
  /**
   * For a `web_extract` contact, the text of its evidence page as `verifyCitation` just re-fetched
   * it. `undefined` if it couldn't be fetched, which fails the check.
   */
  readonly evidencePageText?: string | undefined;
  /** Directories the locale trusts as first-party (en-GB: the NHS service directory). */
  readonly trustedDirectories: readonly string[];
  /**
   * Whether `limits` allow one more dial (I-8), as `limits.mayDial` decides it: `true` when the
   * attempts, minutes and lifetime aren't exhausted, even if the dial must wait ("not before");
   * `false` only when a limit is exhausted. Passed in so this guard and the dialler can't
   * disagree about the limits.
   */
  readonly dialAllowed: boolean;
};

/**
 * `ok` with the phone to dial when all six Q39 conditions hold:
 * 1. the Brief allows automatic switching;
 * 2. the contact came from the user's memory, or from a web page on the business's own domain or
 *    a trusted directory, and its citation still holds;
 * 3. the number has no `number_wrong` observation for this business;
 * 4. the evidence page names the business and matches its postcode or address;
 * 5. the task hasn't switched automatically before;
 * 6. limits allow another dial.
 */
export const mayAutoSwitchContact = (
  input: ContactSwitchInput,
): Result<string, ContactSwitchReason> => {
  const { brief, newContact: contact, business } = input;
  if (!brief.business.contactPolicy.autoSwitchOnWrongNumber) return err("auto_switch_disabled");
  const phone = contact.phone;
  if (phone === undefined) return err("no_new_number");
  if (phone === input.failedPhone) return err("same_number");

  // 2. Where it came from. Only the user's memory or a first-party page; anything else fails.
  /** The re-fetched evidence page, for a web-found contact whose citation still holds. */
  let webPage: string | undefined;
  switch (contact.source) {
    case "user_memory":
      break;
    case "web_extract": {
      if (!isFirstPartySource(contact.evidence.url, business.website, input.trustedDirectories)) {
        return err("source_not_trusted");
      }
      const page = input.evidencePageText;
      if (page === undefined || !citationHolds({ phone }, contact.evidence.quote, page).ok) {
        return err("citation_failed");
      }
      webPage = page;
      break;
    }
    default:
      return err("source_not_trusted");
  }

  // 3. Never a number this business is known not to answer as itself.
  const wrong = input.observations.some(
    (o) =>
      o.businessId === business.businessId && o.kind === "number_wrong" && o.value.e164 === phone,
  );
  if (wrong) return err("known_wrong_number");

  // 4. The page is about this business, here. The user's own memory needs no page.
  if (webPage !== undefined) {
    const named = pageNamesBusiness(webPage, {
      displayName: business.displayName,
      ...(business.postcode === undefined ? {} : { postcode: business.postcode }),
      ...(business.address === undefined ? {} : { address: business.address }),
    });
    if (!named.ok) return err("page_does_not_name_business");
  }

  if (input.autoSwitchesSoFar >= 1) return err("already_switched");
  if (!input.dialAllowed) return err("limits_exhausted");
  return ok(phone);
};
