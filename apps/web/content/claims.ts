// Every user-facing claim about what Faff can and cannot do lives here (I-12, honest capability
// claims: docs/spec/00-invariants.md). Marketing copy and UI strings that describe Faff's
// abilities are read from this file, never written inline in a component.
//
// CHANGES TO THIS FILE NEED REVIEW. .github/CODEOWNERS names its owner. While the owner is the
// only person on the project there are no required approvals (docs/decisions/Q40), so the
// independent PR review (CLAUDE.md, "Pull requests") must check every change here against I-12,
// and the owner reads it before merging. Over-claiming is the failure I-12 exists to prevent:
// say what Faff cannot do, never promise an outcome.

/** The v1 scope, verbatim from docs/spec/README.md. Shown on the M0 placeholder page. */
export const capabilityLine =
  "Book, reschedule and cancel appointments with UK businesses — by phone, or by email where the business prefers it — from a Brief the user approved, with the outcome written back to their calendar and confirmed in writing to both sides.";

/** What Faff cannot do, from I-12. Shown wherever the capability line is. */
export const limitations =
  "Faff always says it's an AI. It can't pass identity or security checks, some businesses will refuse to deal with it or hang up, and it can't guarantee a booking.";

/**
 * The onboarding capability statement (spec 05) and the reminder on every approval card
 * (spec 02). The text lives in core's en-GB catalogue, because the card is rendered there and the
 * catalogue is per locale (spec 12); it is re-exported here so every capability claim can be
 * found from this file. `.github/CODEOWNERS` covers the catalogue too.
 */
export {
  APPROVAL_CARD_REMINDER as approvalCardReminder,
  CAPABILITY_STATEMENT as capabilityStatement,
} from "@faff/core";

/** Until M2 there is no product behind the page, and it must not suggest otherwise. */
export const availability = "Faff isn't open yet.";
