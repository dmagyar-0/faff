# Q21 — Structured profile with per-field disclosure and hard exclusions

- **Status:** Accepted
- **Decided:** 2026-09-22 (round 4)
- **Followed interviewer recommendation:** yes

## Question

What does Faff store about the user, and what may the agent say aloud?

## Decision

A structured profile with a disclosure flag on each field, and each Brief pins which fields it may use. Excluded: payment details and anything that works as an authentication secret. NHS number only with a deliberate, separate opt-in.

## Alternatives considered

- Structured with no exclusions
- A free-text profile
- Store nothing

## Why

If Faff held the answers to security questions, 'we never impersonate' would be a policy rather than a structural fact.

## Consequences

Invariants I-6 and I-7. Profile values reach the agent only through a guarded tool (derived D3).

## Spec

- [../spec/05-onboarding-and-profile.md](../spec/05-onboarding-and-profile.md)
