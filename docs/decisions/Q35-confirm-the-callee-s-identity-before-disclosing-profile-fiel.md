# Q35 — Confirm the callee's identity before disclosing profile fields

- **Status:** Accepted
- **Decided:** 2026-09-22 (rounds 5–6)
- **Followed interviewer recommendation:** yes

## Question

Before saying profile fields, must the agent confirm who answered?

## Decision

Yes. The agent discloses that it is an AI and asks whether this is [business]. All profile fields stay locked until that check passes. On a mismatch it apologises, hangs up and logs a wrong-number observation. The user is never asked.

## Alternatives considered

- Trust the number

## Why

Closes the gap left by Q31: a correctly cited page can still be out of date.

## Consequences

Invariant I-7. Derived D1: the user's name is said after the check. Derived D2: the email equivalent.

## Spec

- [../spec/08-business-resolution.md](../spec/08-business-resolution.md)
