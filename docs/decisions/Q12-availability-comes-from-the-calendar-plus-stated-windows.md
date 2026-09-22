# Q12 — Availability comes from the calendar plus stated windows

- **Status:** Accepted
- **Decided:** 2026-09-20/22 (rounds 1–3)
- **Followed interviewer recommendation:** yes

## Question

Where does Faff learn when the user is free?

## Decision

Calendar free/busy plus windows the user states. Stated windows must work on their own.

## Alternatives considered

- Calendar required
- Stated only

## Why

Calendar access is optional, so the product must work without it.

## Consequences

The `AcceptanceRule` has windows, and `avoidCalendarConflicts` is optional.

## Spec

- [../spec/06-escalation-and-acceptance.md](../spec/06-escalation-and-acceptance.md)
