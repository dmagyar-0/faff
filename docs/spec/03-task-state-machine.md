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

The rules are pure functions in `packages/core/src/limits.ts`: `mayDial` before every dial, `planRedial` after every call that ends without an outcome, `callBudget` for the watchdog (I-8). Precisely:

- **Backoff** is measured from the end of the latest call: 20 minutes after the task's first dial, 2 hours after every later one, including any a raised limit allows. Dials are counted across revisions (G3). If two calls end at the same instant, the later due time wins.
- **Opening hours** are the most recent `opening_hours` observation, in the Brief's timezone. An observation with no periods, or only periods whose `from` equals `to`, says nothing, so the fallback applies. A period with `from > to` runs past midnight and belongs to the day it starts on. Touching periods form one window. A window closes at its `to` minute: 17:30 is closed. A wall time the DST change skips resolves forward, one it repeats resolves to the earlier (as in [06](06-escalation-and-acceptance.md)).
- **Bank holidays are closed** (G24), for observed hours as well as the fallback: the locale's list (en-GB: England & Wales, the one [07](07-channels.md#channel-resolution-q29)'s working days use) is passed in. Some pharmacies open on bank holidays; missing that costs a day's delay, while dialling a closed business costs an attempt.
- **"We're closed"** schedules the redial at the start of the next window that begins after the call, even if the hours said the business was open: those hours were wrong for today. If the hours never close (no window starts after the call), the usual backoff applies.
- **The 5-minute gap** runs from the end of the latest call a person answered (not voicemail, not an IVR alone). It applies to every dial, not only redials.
- **`mayDial`** returns `exhausted(attempts | minutes | lifetime)`, `not_before(at, closed | backoff | human_answered_recently)` or `ok`. Exhausted limits are checked first, in the order attempts, minutes, lifetime; then the 5-minute gap, the scheduled redial time and opening hours. For a redial the worker passes the time `planRedial` scheduled as `notBefore`, so a timer that fires early or twice can't cut the backoff short. Without it the backoff doesn't apply: a revision approved after an escalation may dial as soon as the other rules allow.
- **Usage is rounded up**: 1,740.5 seconds used leaves 59 of 1,800, so a fraction of a second can't buy time past the limit. A counter that isn't a finite, non-negative number can't be trusted and counts as that limit exhausted.
- **A dial needs a minute of call time** (G25). With less than 60 seconds of `maxCallMinutes` left, the minutes are exhausted: the watchdog starts the graceful close 60 seconds before the limit, and a call too short for the disclosure line and a close would break I-4.
- **A lifetime day is 24 hours** (G26) of elapsed time from dispatch (or from approval, for a cancel awaiting confirmation, G15), so a lifetime that crosses a clock change is neither stretched nor shrunk.
- **A wait past the lifetime is exhausted now** (G27). If the next time a dial is allowed (the backoff, the gap, the next opening) is at or after the lifetime's end, the result is `exhausted(lifetime)` and the task escalates with `limit_reached` straight away, rather than sleeping until a wake that could only escalate. The trade-off: a callback or voicemail that might have come in the rest of the lifetime now arrives on an escalated task, where it becomes an inbox item instead of an auto-act.
- **Call budget.** `callBudget(remainingSeconds)` gives the watchdog `closeAfterSeconds` (60 seconds before the limit, or at once with a minute or less left) and `hardStopAfterSeconds`, the limit itself. The provider's `maxDurationSec` is set to the hard stop, never above it, so a missed watchdog still can't run past the limit (`limits_respected`, [11](11-simulation-and-evals.md)). Both are counted in the call's talk-plus-hold seconds; a provider that also counts ringing stops earlier, which is safe.

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
  | { kind: "no_contact"; detail: "no_answer" | "busy" | "voicemail" | "closed" }
  | { kind: "dropped"; by: "callee" | "provider" | "watchdog" };  // system only (M1-Q6)
```

`dropped` is never sent by the agent. The worker records it when a call ends without `end_call`: the callee hung up, the provider failed, or the watchdog cut the call at the minute limit. It is treated as `no_contact` for redials, but kept as itself so it's visible (M1-Q6). The zod schema is `Outcome` in `packages/core/src/outcome.ts`.

`disclosedFields` is checked against the `reveal_profile_field` log for that call. If they don't match, the call is flagged for review.
