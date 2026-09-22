# Q17 — Email comes from a Faff address with a fixed signature

- **Status:** Accepted
- **Decided:** 2026-09-20/22 (rounds 1–3)
- **Followed interviewer recommendation:** yes

## Question

Whose address sends the emails?

## Decision

A Faff address, never the user's Gmail, with a fixed branded signature that carries the disclosure.

## Alternatives considered

- The user's own address with a disclosure footer

## Why

Honest headers. The signature is identical everywhere, not improvised by the agent.

## Consequences

It forces the inbound email path (Q23).

## Spec

- [../spec/07-channels.md](../spec/07-channels.md)
