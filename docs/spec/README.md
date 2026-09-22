# Faff — v1 Specification

**Status:** draft for review · **Date:** 2026-09-22 · **Audience:** agents implementing Faff, and the humans reviewing them.

Faff is a UK consumer web app that handles life admin by phone and email for people who don't want to make the call themselves. The user talks to a chat agent. The chat agent drafts a **Task Brief**, the user approves it, and a phoning (or emailing) agent carries it out. That agent can do only what the Brief permits.

> **v1 scope, in one sentence.** Book, reschedule and cancel appointments with UK businesses — by phone, or by email where the business prefers it — from a Brief the user approved, with the outcome written back to their calendar and confirmed in writing to both sides.

This is an **implementation brief with the reasoning written inline.** Where a rule looks like friction, the reasoning explains why it's there. Don't refactor a rule away without first reading its decision record in [`../decisions/`](../decisions/).

## How to read this

Read [`00-invariants.md`](00-invariants.md) before anything else. The invariants are the only part of the spec that is not negotiable in implementation. Everything else is a design that can be improved, as long as no invariant is broken.

| File | Covers |
|---|---|
| [00-invariants.md](00-invariants.md) | Hard rules, and where each is enforced in code |
| [01-architecture.md](01-architecture.md) | Stack, repo layout, process boundaries, the `CallProvider` seam |
| [02-task-brief.md](02-task-brief.md) | Brief schema, versioning, approval |
| [03-task-state-machine.md](03-task-state-machine.md) | Task states, transitions, guards |
| [04-data-model.md](04-data-model.md) | Tables, the two memory tiers, the observation log |
| [05-onboarding-and-profile.md](05-onboarding-and-profile.md) | Sign-in, profile, disclosable fields, exclusions |
| [06-escalation-and-acceptance.md](06-escalation-and-acceptance.md) | Acceptance rules, escalation contract, cancel gate |
| [07-channels.md](07-channels.md) | Phone vs email resolution, outbound email, inbound path |
| [08-business-resolution.md](08-business-resolution.md) | Finding and verifying contact details; confirming the callee's identity |
| [09-outcomes-and-proof.md](09-outcomes-and-proof.md) | Report, calendar event, confirmation email, notifications |
| [10-recording-and-retention.md](10-recording-and-retention.md) | Audio, transcripts, retention, third-party rights |
| [11-simulation-and-evals.md](11-simulation-and-evals.md) | Simulated callee, scenario suite, the gate for real calls |
| [12-locale-roadmap.md](12-locale-roadmap.md) | Locale discipline and the Hungary note |

## Explicitly out of scope for v1

- **Real outbound calls in production.** They exist behind a flag, and the flag is gated by the eval suite ([11](11-simulation-and-evals.md)).
- **Money.** No billing, pricing or payment provider (Q26). Per-task limits on attempts and minutes *are* in scope, as a reliability rule (Q27).
- **The GP 8am scramble** (Q11).
- **Customer-service tasks:** refunds, complaints, haggling, subscription cancellation. Anything behind an authentication wall (banks, telcos, utilities).
- **Live mid-call escalation to the user.** v1 ends the call politely and escalates asynchronously ([06](06-escalation-and-acceptance.md)).
- **An MCP / external-LLM front end.** The Brief is versioned and documented so this can be added later as an adapter (Q15).
- **Non-UK locales.** The schema is locale-aware, but only `en-GB` ships (Q18).
- **Moving an appointment between two different businesses** as a single task. It is modelled as two linked Briefs ([06](06-escalation-and-acceptance.md#paired-cancellation)).

## Decisions derived while writing (need review)

The interview (Q1–Q38) didn't cover these. Each one follows from settled decisions, but a human should confirm or overturn it. They are marked **[derived]** where they appear.

| ID | Derived decision | Where |
|---|---|---|
| D1 | The call opener discloses AI status and checks the business's identity *before* naming the user. Invariant 1 still holds: the disclosure is the first thing said to a human. | [08](08-business-resolution.md#callee-identity-check) |
| D2 | An email to an address with no successful prior exchange discloses only the user's name. All other fields wait for a reply. This is the email equivalent of Q35. | [07](07-channels.md#outbound-email) |
| D3 | Profile values are never put in the agent's prompt. The agent asks for a value through a tool, and the server checks the Brief's allow-list and whether identity has been confirmed. | [01](01-architecture.md#the-tool-server-is-the-enforcement-point) |
| D4 | Approval is a UI action tied to a hash of the exact Brief revision, never a chat message such as "yes". | [02](02-task-brief.md#approval) |
| D5 | In v1, escalation means ending the call and sending a revised Brief for approval; the agent never keeps a receptionist on hold. | [06](06-escalation-and-acceptance.md#escalation-contract) |
| D6 | Default limits: 3 dial attempts, 30 call minutes (talk plus hold), 7 days of task lifetime. | [02](02-task-brief.md#limits) |
| D7 | Calendar access uses an app-created "Faff" calendar plus free/busy read access. | [09](09-outcomes-and-proof.md#calendar-event) |
| D8 | The job queue is Postgres-native (Supabase Queues / `pgmq`). The worker host is left open. | [01](01-architecture.md) |
| D9 | The hosted voice vendor (Vapi, Retell, …) is chosen at implementation time behind `CallProvider`. | [01](01-architecture.md#callprovider) |
| D10 | The general knowledge tier never holds user personal data. | [04](04-data-model.md#general-tier-business_observations) |
