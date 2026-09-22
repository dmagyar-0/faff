# Q13 — Faff resolves phone numbers and remembers, in two tiers

- **Status:** Accepted
- **Decided:** 2026-09-20/22 (rounds 1–3)
- **Followed interviewer recommendation:** yes

## Question

Who finds the business's contact details?

## Decision

Faff does, and remembers them in two tiers: a trusted per-user tier and a general tier.

## Alternatives considered

- The user always supplies the number

## Why

Making the user look up the number is the very faff the product is named against. The general tier is the moat the research describes.

## Consequences

The general tier's design is Q19. The lookup method is Q28.

## Spec

- [../spec/04-data-model.md](../spec/04-data-model.md)
- [../spec/08-business-resolution.md](../spec/08-business-resolution.md)
