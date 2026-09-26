# Q40 — No required approvals while the owner is the only person

- **Status:** Accepted. Changes how I-12's "a review is required" is met; I-12 itself is unchanged
- **Decided:** 2026-09-26 (owner, during M0 PR 0.3/0.4)
- **Followed interviewer recommendation:** not asked in the interview

## Question

The M0 plan asked for branch protection that requires one review, and a CODEOWNERS entry that makes a review of `apps/web/content/claims.ts` required (I-12). The owner is the only person on the project, and GitHub doesn't let a PR's author approve it. Who reviews?

## Decision

No required approvals or code-owner reviews on GitHub while the owner is the only person. Instead, every PR goes through the loop in `CLAUDE.md` ("Pull requests"):

1. CI must be green.
2. An independent review subagent, given only the owner's intent and the diff, reviews it. Findings are fixed or answered, and CI and review repeat until nothing blocking is left.
3. When the diff touches `claims.ts`, the reviewer must check every changed claim against I-12.
4. The owner reads the PR before merging it.

`.github/CODEOWNERS` stays as the record of who owns `claims.ts`, and the rails self-test still fails if that entry goes.

## Alternatives considered

- Require a code-owner review on GitHub. With one person, every `claims.ts` change would need an admin bypass, so the requirement would be routinely overridden.
- A second GitHub account for reviews. It adds process with no second person behind it.

## Why

A required review that can only be satisfied by bypassing it isn't a control. The independent review is a real second reading, by a reviewer with no stake in the implementation. It is weaker than a mechanical gate. It is a documented process, not code, and it doesn't meet the spec's own bar ("an invariant enforced only by a prompt isn't enforced"). This record exists so that the gap is visible rather than implied away.

## Consequences

- I-12's "Enforced" line points here.
- When a second person joins, turn on branch protection with "Require review from Code Owners" and supersede this record.

## Spec

- [../spec/00-invariants.md](../spec/00-invariants.md#i-12--honest-capability-claims)
