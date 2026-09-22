# Q15 — Faff has its own chat UI in v1

- **Status:** Accepted
- **Decided:** 2026-09-20/22 (rounds 1–3)
- **Followed interviewer recommendation:** yes

## Question

Does Faff ship its own chat, or front itself through Claude or ChatGPT?

## Decision

Its own chat in v1. An MCP / external-LLM surface comes later.

## Alternatives considered

- MCP only from day one

## Why

It keeps control of approval UX. The Brief is designed as a public object so the external surface is an adapter later.

## Consequences

The Brief schema is exported as JSON Schema.

## Spec

- [../spec/02-task-brief.md](../spec/02-task-brief.md)
