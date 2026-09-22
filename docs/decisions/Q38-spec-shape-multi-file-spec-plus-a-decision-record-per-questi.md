# Q38 — Spec shape: multi-file spec plus a decision record per question

- **Status:** Accepted
- **Decided:** 2026-09-22 (rounds 5–6)
- **Followed interviewer recommendation:** yes

## Question

How is the spec laid out in the repo?

## Decision

`docs/spec/` with one file per section, and `docs/decisions/` with one short record per settled question, including its reasoning.

## Alternatives considered

- A single SPEC.md
- A spec plus CLAUDE.md

## Why

Agents can load only what they need, and each decision's reasoning survives.

## Consequences

Changing an invariant requires a superseding decision record.

## Spec

- [../spec/README.md](../spec/README.md)
