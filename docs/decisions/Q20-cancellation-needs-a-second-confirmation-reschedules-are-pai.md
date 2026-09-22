# Q20 — Cancellation needs a second confirmation; reschedules are paired

- **Status:** Accepted
- **Decided:** 2026-09-22 (round 4)
- **Followed interviewer recommendation:** yes

## Question

What's the gate on cancellation?

## Decision

An explicit second confirmation that names the specific appointment, after approval and before dialling. Anything framed as a reschedule is paired by default: the replacement is secured before the old slot is released.

## Alternatives considered

- The same flow as any Brief
- Always paired, with no second confirmation

## Why

Cancel is the only verb that destroys something that can't be recovered. Most 'cancel' intents are really 'move' intents.

## Consequences

Invariant I-10. A cross-business move is two linked Briefs.

## Spec

- [../spec/06-escalation-and-acceptance.md](../spec/06-escalation-and-acceptance.md)
- [../spec/03-task-state-machine.md](../spec/03-task-state-machine.md)
