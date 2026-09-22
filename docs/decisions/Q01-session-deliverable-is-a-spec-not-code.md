# Q1 — Session deliverable is a spec, not code

- **Status:** Accepted
- **Decided:** 2026-09-20/22 (rounds 1–3)
- **Followed interviewer recommendation:** yes

## Question

What should the design session produce?

## Decision

A spec/architecture document only. No code.

## Alternatives considered

- Start scaffolding code alongside the spec

## Why

The product's hard parts are boundaries (what the agent may say, do, destroy). Settling those in prose first is cheaper than refactoring code that encoded the wrong boundary.

## Consequences

The spec is the deliverable of the first PR. Implementation happens in later sessions.

## Spec

- [../spec/README.md](../spec/README.md)
