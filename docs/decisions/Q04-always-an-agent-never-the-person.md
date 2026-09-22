# Q4 — Always an agent, never the person

- **Status:** Accepted
- **Decided:** 2026-09-20/22 (rounds 1–3)
- **Followed interviewer recommendation:** yes

## Question

What identity does Faff present on phone and email?

## Decision

Always disclosed as an AI agent acting on behalf of a named user. Never impersonates the user, and never uses a cloned voice.

## Alternatives considered

- Speak as the user
- A light-touch footer from the user's own email

## Why

An agent speaking in a real person's voice to pass a security check is a fraud tool, whatever the consent flow. Honest headers matter more than a light touch, and a footer is the part of an email people ignore.

## Consequences

Invariants I-1 and I-2. Some businesses will refuse, which is accepted as market risk, not engineered around.

## Spec

- [../spec/00-invariants.md](../spec/00-invariants.md)
