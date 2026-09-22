# Q26 — Money is out of scope

- **Status:** Accepted
- **Decided:** 2026-09-22 (round 4)
- **Followed interviewer recommendation:** **no**

## Question

Does the spec cover money (quotas, cost ceilings, billing)?

## Decision

Out of scope. No billing, pricing, quotas or payment provider in the spec.

## Alternatives considered

- Entitlements plus a per-task cost ceiling (recommended)
- Full billing design

## Why

The user chose this without giving a reason. Presumed: keep commercial design out of an engineering spec until the product is proven.

## Consequences

The reliability half of the recommendation survives as Q27 (limits on attempts and minutes, not pounds). **Diverged from the interviewer's recommendation.**

## Spec

- [../spec/README.md](../spec/README.md)
