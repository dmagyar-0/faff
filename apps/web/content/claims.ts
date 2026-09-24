// Marketing copy and UI claims about what Faff can do (I-12, docs/spec/00-invariants.md).
//
// Every user-facing statement of capability lives here and nowhere else, so that changing one
// is a visible diff in one file. CODEOWNERS makes a review required for any change to it.
// Faff states what it cannot do: it cannot pass identity checks, it will sometimes be refused
// or hung up on, and it cannot guarantee a booking. Never add a claim that over-promises.

/** The one-line description of the product, shown on the placeholder page. */
export const capabilityLine =
  "Faff books, reschedules and cancels appointments by phone and email, through an agent that always says it's an AI.";
