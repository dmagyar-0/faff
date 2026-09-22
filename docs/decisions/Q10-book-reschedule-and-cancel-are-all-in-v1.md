# Q10 — Book, reschedule and cancel are all in v1

- **Status:** Accepted
- **Decided:** 2026-09-20/22 (rounds 1–3)
- **Followed interviewer recommendation:** **no**

## Question

Which booking verbs?

## Decision

All three: book, reschedule, cancel. A calendar connection is wanted.

## Alternatives considered

- Defer cancel

## Why

The user wanted the full lifecycle. Cancel is the one destructive verb, so it is gated rather than deferred (see Q20).

## Consequences

Cancel gate: I-10.

## Spec

- [../spec/06-escalation-and-acceptance.md](../spec/06-escalation-and-acceptance.md)
