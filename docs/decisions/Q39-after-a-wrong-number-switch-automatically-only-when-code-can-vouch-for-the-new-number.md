# Q39 — After a wrong number, switch automatically only when code can vouch for the new number

- **Status:** Accepted
- **Decided:** 2026-09-24 (design review of the implementation plan, gap G2)
- **Followed interviewer recommendation:** no (the recommendation was always to ask)

## Question

When a call reaches the wrong business, contact resolution finds another number. The approved Brief named the old number. May Faff dial the new one without asking the user again?

## Decision

Yes, when the new contact passes a **deterministic confidence check**. Otherwise the task escalates and the user approves the new number with one tap.

"Confident" is decided by code, never by the model (the same principle as I-9 and I-11). The new contact must meet every one of these conditions:

1. It came from the user's own memory, **or** it passed `verifyCitation` (I-11) on a page from the business's own domain or the NHS service directory. Third-party directories don't qualify.
2. It isn't any number with a `number_wrong` observation for this business.
3. It is for the same business: same `business_id`, and the cited page names the business's display name and matches its postcode or address.
4. This is the task's **first** automatic switch. A second wrong number always escalates.
5. The task still has limits left. The redial counts as an attempt (I-8).

## Alternatives considered

- Always ask the user again (the recommendation, for literal I-3)
- Let the agent decide, based on its own judgement

## Why

Asking every time adds friction to the most common fix, a number that has changed on the business's own website. Letting the model decide would put an unverifiable judgement where the spec requires code to decide. A fixed rule keeps the convenience and stays auditable. The call's identity check (Q35, I-7) still has to pass before anything personal is said, so the remaining risk is limited to one more wasted call.

## Consequences

- **The Brief carries the pre-authorisation.** `business.contactPolicy.autoSwitchOnWrongNumber` (default `true`) appears on the approval card: "If this number turns out to be wrong, Faff may try one other number for this business from your saved details or the business's own website." That keeps I-3 intact: the user approved the rule in advance, as with the acceptance rule (Q24).
- **The Brief isn't edited.** The switch is recorded as a `contact_switched` task event carrying the new `ResolvedContact` and its evidence. The worker dials the task's current contact. The report shows the switch.
- If any condition fails, the task escalates with `wrong_business_unresolved` and a suggested action to approve the new number.

## Spec

- [../spec/02-task-brief.md](../spec/02-task-brief.md)
- [../spec/03-task-state-machine.md](../spec/03-task-state-machine.md)
- [../spec/08-business-resolution.md](../spec/08-business-resolution.md)
