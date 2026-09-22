# Q24 — The Brief carries a pre-authorised acceptance rule

- **Status:** Accepted
- **Decided:** 2026-09-22 (round 4)
- **Followed interviewer recommendation:** yes

## Question

Who decides between offered slots?

## Decision

The Brief carries a pre-authorised acceptance rule. The agent picks within it, and escalation fires only for offers outside it.

## Alternatives considered

- Bounce every offer to the user mid-call
- Agent's judgement

## Why

Bouncing every offer means a receptionist waiting on a push notification. Agent judgement is reckless. This choice is what makes Q7 workable.

## Consequences

Invariant I-9: acceptance is decided by deterministic code (`evaluateAcceptance`), never by an LLM.

## Spec

- [../spec/06-escalation-and-acceptance.md](../spec/06-escalation-and-acceptance.md)
