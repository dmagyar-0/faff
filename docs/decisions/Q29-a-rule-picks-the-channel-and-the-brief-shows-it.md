# Q29 — A rule picks the channel and the Brief shows it

- **Status:** Accepted
- **Decided:** 2026-09-22 (rounds 5–6)
- **Followed interviewer recommendation:** yes

## Question

How does a Brief choose phone vs email?

## Decision

A deterministic rule: use email if recent observations say the business prefers it, or if no phone number is known. Otherwise phone. Shown on the Brief and overridable. Email falls back to phone after a deadline with no reply.

## Alternatives considered

- The user picks every time
- Phone only in v1

## Why

It keeps the decision out of LLM judgement while staying visible to the user.

## Consequences

Default fallback: 2 working days.

## Spec

- [../spec/07-channels.md](../spec/07-channels.md)
