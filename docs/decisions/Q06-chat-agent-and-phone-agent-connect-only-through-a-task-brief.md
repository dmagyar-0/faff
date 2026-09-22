# Q6 — Chat agent and phone agent connect only through a Task Brief

- **Status:** Accepted
- **Decided:** 2026-09-20/22 (rounds 1–3)
- **Followed interviewer recommendation:** yes

## Question

How does the chat agent instruct the executing agent?

## Decision

Through an approved, bounded Task Brief. Nothing else reaches the phone agent.

## Alternatives considered

- The chat agent drives the call directly
- A shared free-form context

## Why

The Brief is the safety boundary, the audit log, the liability answer, the unit of async UX and (later) the billing unit.

## Consequences

Invariant I-3. The Brief is versioned and documented so an MCP front end can be added later as an adapter.

## Spec

- [../spec/02-task-brief.md](../spec/02-task-brief.md)
