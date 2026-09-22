# Q22 — Calendar write access limited to events Faff created

- **Status:** Accepted
- **Decided:** 2026-09-22 (round 4)
- **Followed interviewer recommendation:** yes

## Question

How does the booking reach the user's calendar?

## Decision

Write access limited to events Faff itself created.

## Alternatives considered

- Full Google Calendar write access
- An .ics invite by email

## Why

Write access to a primary calendar is the heaviest permission in the product, and limiting it makes the request defensible. An invite the user hasn't accepted isn't proof (undercuts Q14).

## Consequences

Derived D7: enforced by the `calendar.app.created` scope (a 'Faff' calendar) plus `calendar.freebusy`. Verify at implementation.

## Spec

- [../spec/09-outcomes-and-proof.md](../spec/09-outcomes-and-proof.md)
