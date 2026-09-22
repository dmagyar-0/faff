# Q7 — Escalate at the Brief boundary; run to completion to start

- **Status:** Accepted
- **Decided:** 2026-09-20/22 (rounds 1–3)
- **Followed interviewer recommendation:** yes

## Question

What happens when the call hits something the Brief doesn't cover?

## Decision

Escalate when the agent reaches the edge of the Brief. Running to completion (end the call, escalate asynchronously) is acceptable in v1.

## Alternatives considered

- Live mid-call escalation from day one
- The agent improvises

## Why

Live escalation needs a sub-minute response channel. The acceptance rule (Q24) makes asynchronous escalation rare enough.

## Consequences

Derived D5: the agent ends politely and escalates with a structured payload. The schema allows live escalation later.

## Spec

- [../spec/06-escalation-and-acceptance.md](../spec/06-escalation-and-acceptance.md)
