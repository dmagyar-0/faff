# Q32 — Notifications: an in-app inbox plus email

- **Status:** Accepted
- **Decided:** 2026-09-22 (rounds 5–6)
- **Followed interviewer recommendation:** yes

## Question

How does Faff reach the user when a decision is needed?

## Decision

The in-app inbox is the source of truth. An email carries a deep link. No native app in v1.

## Alternatives considered

- Web push
- SMS

## Why

Reliable across devices without iOS push complications or an SMS provider.

## Consequences

Web push later.

## Spec

- [../spec/09-outcomes-and-proof.md](../spec/09-outcomes-and-proof.md)
