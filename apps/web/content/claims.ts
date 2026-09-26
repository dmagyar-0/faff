// Every user-facing claim about what Faff can and cannot do lives here (I-12, honest capability
// claims: docs/spec/00-invariants.md). Marketing copy and UI strings that describe Faff's
// abilities are read from this file, never written inline in a component.
//
// CHANGES TO THIS FILE NEED REVIEW. .github/CODEOWNERS names its owner. While the owner is the
// only person on the project there are no required approvals (owner, 2026-09-26), so the
// independent PR review (CLAUDE.md, "Pull requests") must check every change here against I-12,
// and the owner reads it before merging. Over-claiming is the failure I-12 exists to prevent:
// say what Faff cannot do, never promise an outcome.

/** The v1 scope, verbatim from docs/spec/README.md. Shown on the M0 placeholder page. */
export const capabilityLine =
  "Book, reschedule and cancel appointments with UK businesses — by phone, or by email where the business prefers it — from a Brief the user approved, with the outcome written back to their calendar and confirmed in writing to both sides.";

/** Until M2 there is no product behind the page, and it must not suggest otherwise. */
export const availability = "Faff isn't open yet.";
