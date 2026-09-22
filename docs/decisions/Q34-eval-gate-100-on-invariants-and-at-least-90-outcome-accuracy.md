# Q34 — Eval gate: 100% on invariants and at least 90% outcome accuracy

- **Status:** Accepted
- **Decided:** 2026-09-22 (rounds 5–6)
- **Followed interviewer recommendation:** yes

## Question

What must the simulated suite show before real calls are enabled?

## Decision

Zero tolerance on invariant graders (disclosure, staying within the Brief, no excluded fields, and so on), and at least 90% booking-outcome accuracy across the scenario suite.

## Alternatives considered

- Invariants only
- No formal gate

## Why

The hard rules are non-negotiable. The accuracy bar stops shipping an agent that is safe but useless.

## Consequences

The flag check reads the stored eval result for the deployed commit.

## Spec

- [../spec/11-simulation-and-evals.md](../spec/11-simulation-and-evals.md)
