# 03 — Task State Machine

A **task** is one approved Brief being carried out, possibly across several calls and emails. The state machine lives in `packages/core/task-machine.ts` as pure functions (`transition(state, event) → state | error`). The worker is the only process that applies transitions, apart from user actions made through the web app. Every applied transition appends a row to `task_events`, which is append-only.

## States

| State | Meaning |
|---|---|
| `draft` | A Brief revision exists but is not approved. Not yet a queued task. |
| `awaiting_cancel_confirmation` | Only when `verb = cancel`. Approved, waiting for the second confirmation (I-10). |
| `waiting_on_pair` | A paired cancel whose booking Brief hasn't completed yet. |
| `queued` | Ready for the worker. |
| `in_progress` | A call is live, or an email is being composed and sent. |
| `waiting` | Between attempts: redial backoff, an email sent and waiting for a reply, or an expected callback. |
| `escalated` | Needs a user decision. Carries a structured `escalation` payload ([06](06-escalation-and-acceptance.md)). |
| `completed` | Outcome achieved and recorded ([09](09-outcomes-and-proof.md)). Terminal. |
| `failed` | Couldn't be achieved and no decision can rescue it. Terminal, with a `failure_reason`. |
| `withdrawn` | The user cancelled the task. Terminal. |

## Transitions

| From | Event | To | Guard / requirement |
|---|---|---|---|
| `draft` | `user.approve(rev, hash)` | `queued` | Hash matches; verb ≠ cancel; contact verified (I-11) |
| `draft` | `user.approve(rev, hash)` | `awaiting_cancel_confirmation` | verb = cancel |
| `awaiting_cancel_confirmation` | `user.confirm_cancel(appointmentId)` | `queued` / `waiting_on_pair` | The confirmation names the Brief's `existingAppointment.appointmentId`; goes to `waiting_on_pair` if `cancel.mode = paired` |
| `waiting_on_pair` | `pair.completed` | `queued` | The paired booking Brief is `completed` with a new appointment |
| `waiting_on_pair` | `pair.failed` / `pair.withdrawn` | `withdrawn` | The old appointment is kept. The user is told. |
| `queued` | `worker.start` | `in_progress` | Limits not exhausted |
| `in_progress` | `call.ended(outcome=success)` | `completed` | The structured outcome validates, and proof steps are enqueued |
| `in_progress` | `call.ended(no_answer/busy/voicemail/hung_up)` | `waiting` | Attempts remain (see redial policy) |
| `in_progress` | `call.ended(outside_rule_offers)` | `escalated` | At least one recorded offer |
| `in_progress` | `call.ended(wrong_business)` | `waiting` | A wrong-number observation is logged and contact resolution re-runs ([08](08-business-resolution.md)). The new contact passes the Q39 confidence check, and the Brief allows `autoSwitchOnWrongNumber`. A `contact_switched` event is recorded |
| `in_progress` | `call.ended(wrong_business)` | `escalated` | Otherwise. Reason `wrong_business_unresolved`, with a suggested action to approve the new number (Q39) |
| `in_progress` | `call.ended(refused_ai)` | `escalated` | Reason `refused_ai`. The user may call themselves or switch to email. |
| `in_progress` | `email.sent` | `waiting` | — |
| `waiting` | `timer.redial` | `queued` | — |
| `waiting` | `email.reply(in_rule)` | `in_progress` | Auto-act carve-out (Q23): the reply offers a slot that `evaluateAcceptance` accepts, and verb ≠ cancel |
| `waiting` | `email.reply(other)` / `voicemail.received` | `escalated` | Reason `inbound_needs_decision` |
| `waiting` | `timer.email_fallback` | `queued` | Channel switches to phone (Q29); the switch is recorded in `task_events` |
| any active | `limit.reached` | `escalated` | Reason `limit_reached` (I-8) |
| `escalated` | `user.approve(newRev, hash)` | `queued` | A new Brief revision that resolves the escalation |
| `escalated` | `user.give_up` | `failed` | — |
| any non-terminal | `user.withdraw` | `withdrawn` | A live call is ended politely first (never abandoned, I-4) |
| any active | `timer.lifetime_expired` | `escalated` → `failed` after 48h without a response | — |

## Redial policy

- No answer / busy: retry after 20 min, then 2 h, within the business's opening hours (from observations, or 09:00–17:30 Mon–Fri as a fallback).
- Never more than `limits.maxDialAttempts` attempts in total.
- Never redial within 5 minutes of a call that a human answered (Ofcom abandonment pattern avoidance, I-4).
- If an IVR says the business is closed, that counts as an attempt, logs an opening-hours observation and reschedules into the next opening window.

## Outcome schema (from `end_call` / email completion)

```ts
type Outcome =
  | { kind: "booked"; appointment: { startsAt; endsAt?; practitioner?; reference? }; disclosedFields: ProfileField[] }
  | { kind: "rescheduled"; from: AppointmentRef; to: {...} ; disclosedFields }
  | { kind: "cancelled"; appointment: AppointmentRef; reference?; disclosedFields }
  | { kind: "outside_rule_offers"; offers: Slot[] }
  | { kind: "no_availability"; nextAvailableHint?: string }
  | { kind: "wrong_business" }
  | { kind: "refused_ai" }
  | { kind: "needs_user"; reason: string }       // e.g. they insist on speaking to the patient
  | { kind: "no_contact"; detail: "no_answer" | "busy" | "voicemail" | "closed" };
```

`disclosedFields` is checked against the `reveal_profile_field` log for that call. If they don't match, the call is flagged for review.
