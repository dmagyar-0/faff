# Q33 — Real calls use a hosted voice-agent platform

- **Status:** Accepted
- **Decided:** 2026-09-22 (rounds 5–6)
- **Followed interviewer recommendation:** yes

## Question

Build a voice pipeline or use a hosted platform?

## Decision

A hosted voice-agent platform (Vapi, Retell or similar) behind `CallProvider`. Faff supplies the policy and tools.

## Alternatives considered

- Own pipeline on Twilio
- Defer entirely

## Why

The fastest route to under 700ms latency and good turn-taking. The interface keeps it swappable.

## Consequences

Derived D9: vendor chosen at implementation. Tools arrive as signed webhooks with per-call tokens.

## Spec

- [../spec/01-architecture.md](../spec/01-architecture.md)
