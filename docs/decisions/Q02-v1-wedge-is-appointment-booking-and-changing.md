# Q2 — v1 wedge is appointment booking and changing

- **Status:** Accepted
- **Decided:** 2026-09-20/22 (rounds 1–3)
- **Followed interviewer recommendation:** yes

## Question

Which task family does v1 target?

## Decision

Booking, rescheduling and cancelling appointments with UK businesses, not the research document's customer-service concierge (hold-waiting, refunds, cancellations, haggling).

## Alternatives considered

- Customer-service primitive (hold, refunds, complaints)
- Mixed concierge

## Why

The research names authentication friction as the #1 risk. A dentist needs a name and date of birth, not a memorable word, so the wall mostly disappears. Disclosure is also cheaper with a receptionist than with a fraud team.

## Consequences

No success fee exists, so monetisation is subscription only. The receptionist (busy, with a queue) is a likelier hang-up than a contact-centre agent. See handoff §3.1.

## Spec

- [../spec/README.md](../spec/README.md)
