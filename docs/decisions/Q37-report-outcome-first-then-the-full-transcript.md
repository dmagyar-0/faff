# Q37 — Report: outcome first, then the full transcript

- **Status:** Accepted
- **Decided:** 2026-09-22 (rounds 5–6)
- **Followed interviewer recommendation:** yes

## Question

What does the user see after a task?

## Decision

The structured outcome at the top, including exactly which fields were disclosed. The full raw transcript below it. Audio playable while it exists.

## Alternatives considered

- Outcome only
- Outcome plus an LLM summary

## Why

An LLM summary is exactly the kind of paraphrase the user distrusts.

## Consequences

The disclosed fields come from the `field_reveals` audit, not from the agent's own account.

## Spec

- [../spec/09-outcomes-and-proof.md](../spec/09-outcomes-and-proof.md)
