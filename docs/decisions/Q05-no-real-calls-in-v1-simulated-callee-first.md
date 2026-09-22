# Q5 — No real calls in v1; simulated callee first

- **Status:** Accepted
- **Decided:** 2026-09-20/22 (rounds 1–3)
- **Followed interviewer recommendation:** yes

## Question

Does v1 make real phone calls?

## Decision

No. A `CallProvider` interface plus a simulated callee. The real provider sits behind a flag.

## Alternatives considered

- Real calls from day one

## Why

A phone agent that can't be run 200 times against a scripted hostile callee can't be improved. The simulator is the test suite.

## Consequences

The eval gate (Q34) controls the flag.

## Spec

- [../spec/01-architecture.md](../spec/01-architecture.md)
- [../spec/11-simulation-and-evals.md](../spec/11-simulation-and-evals.md)
