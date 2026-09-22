# Q31 — Web-found contacts need a verbatim citation, with no user confirmation

- **Status:** Accepted
- **Decided:** 2026-09-22 (rounds 5–6)
- **Followed interviewer recommendation:** **no**

## Question

What must an LLM-extracted contact pass before Faff uses it?

## Decision

Each candidate carries a source URL and an exact quote. Deterministic code re-fetches the page and checks the value appears verbatim. The user is not asked to confirm (the evidence is shown on the Brief).

## Alternatives considered

- Citation plus user confirmation (recommended)
- Trust the extraction

## Why

The user chose this without giving a reason. Presumed: the citation check removes hallucinated numbers without adding a step for the user.

## Consequences

Invariant I-11. The remaining risk (an out-of-date but correctly cited number) is covered by Q35. **Diverged from the interviewer's recommendation.**

## Spec

- [../spec/08-business-resolution.md](../spec/08-business-resolution.md)
