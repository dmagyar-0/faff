# Q27 — Per-task limits on attempts, minutes and lifetime

- **Status:** Accepted
- **Decided:** 2026-09-22 (rounds 5–6)
- **Followed interviewer recommendation:** yes

## Question

With billing out, does each task still get a hard limit on runaway behaviour?

## Decision

Yes. Each Brief carries a maximum number of dial attempts, maximum call minutes (talk plus hold) and a maximum wall-clock lifetime. Hitting any of them aborts the task and escalates. Money isn't involved.

## Alternatives considered

- Global defaults only
- No limit

## Why

A task that redials, holds, gets transferred and waits for callbacks can run without bound. That's a reliability failure first. Adding pricing later becomes a matter of converting the minutes.

## Consequences

Invariant I-8. Defaults (derived D6): 3 attempts, 30 min, 7 days.

## Spec

- [../spec/02-task-brief.md](../spec/02-task-brief.md)
- [../spec/03-task-state-machine.md](../spec/03-task-state-machine.md)
