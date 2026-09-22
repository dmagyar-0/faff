# Q28 — Contact lookup by web search plus LLM extraction

- **Status:** Accepted
- **Decided:** 2026-09-22 (rounds 5–6)
- **Followed interviewer recommendation:** **no**

## Question

Where does Faff find a business's number or email when it has no memory of it?

## Decision

Web search followed by LLM extraction.

## Alternatives considered

- A places API with the user confirming (recommended)
- The user supplies it

## Why

The user chose this without giving a reason. Presumed: it covers more businesses (including small independent practices) and needs no paid places-API key.

## Consequences

It sits uneasily with Q19's distrust of LLM-produced facts, so it is guarded by Q31 (citation) and Q35 (identity check). **Diverged from the interviewer's recommendation.**

## Spec

- [../spec/08-business-resolution.md](../spec/08-business-resolution.md)
