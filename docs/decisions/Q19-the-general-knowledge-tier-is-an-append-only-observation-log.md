# Q19 — The general knowledge tier is an append-only observation log

- **Status:** Accepted
- **Decided:** 2026-09-22 (round 4)
- **Followed interviewer recommendation:** yes

## Question

How does the general knowledge base avoid becoming confidently-wrong LLM memory? (Raised by the user: 'I hate when LLM handles memory like source of truth.')

## Decision

An append-only log of observations, each timestamped and tied to the call, email or URL that produced it. Nothing is ever edited. Fast lookups use a derived cache with a time limit, which is thrown away rather than corrected and is never written back into the log.

## Alternatives considered

- Editable entry per business with an LLM confidence score
- No general tier

## Why

Staleness becomes visible instead of silent, and provenance comes free. No LLM ever overwrites what a previous LLM wrote, which is how these stores rot.

## Consequences

Invariant I-5. The derivation is a deterministic function. Derived D10: no user personal data in this tier.

## Spec

- [../spec/04-data-model.md](../spec/04-data-model.md)
