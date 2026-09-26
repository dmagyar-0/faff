# 06 — Acceptance Rules, Escalation and the Cancel Gate

## Acceptance rules (Q24)

The user decides the *shape* of an acceptable answer in advance. The agent chooses within it. Code, not the model, decides whether an offer fits (I-9). This is what makes escalation (Q7) workable: a receptionist won't hold while Faff waits for a push notification, and letting the agent take anything plausible is reckless.

```ts
type AcceptanceRule = {
  windows: Window[];                      // at least one; union of allowed times
  avoidCalendarConflicts: boolean;        // requires calendar free/busy (Q12); default true if connected
  bufferMinutes?: number;                 // travel/buffer around existing events, default 30
  preference: "earliest" | "latest" | { closestTo: string };
  practitioner?: { mustBe?: string; avoid?: string[] };
  minNoticeHours?: number;                // don't accept something in 2 hours' time
};

type Window =
  | { kind: "absolute"; start: string; end: string }                      // "2026-10-05T09:00+01:00" .. "…T12:00"
  | { kind: "recurring"; days: Weekday[]; from: "HH:MM"; to: "HH:MM";
      between: { start: string; end: string } };                           // "weekday mornings until 31 Oct"
```

**`between` (G17, M1-Q5):** `start` and `end` are **local dates** (`YYYY-MM-DD`) in the Brief's timezone, and both are **inclusive**: `end: "2026-10-31"` allows a window occurrence that starts on 31 October. `from` and `to` are wall-clock `HH:MM`. Every absolute-window datetime is RFC 3339 with an offset (see [02](02-task-brief.md#shape-rules-m1)).

`evaluateAcceptance(rule, slot, busy[]) → accept | reject(reason) | outside_rule` is a pure function in `core`, with thorough unit tests (DST boundaries, windows crossing midnight, buffers).

**How the agent uses it on a call:**
1. The agent asks for availability in words that match the rule ("anything on weekday mornings before the end of October?").
2. For each offered slot the agent calls `propose_slot`. On `accept` it takes the slot, following `preference` when several are offered: it asks for all the options first, then chooses.
3. Slots that don't fit are logged with `record_offer`. The agent may ask once for alternatives inside the rule.
4. If nothing fits, the agent ends the call politely ("I'll check with David and get back to you") → `outside_rule_offers`.

**Stated windows work alone (Q12).** Without a calendar, `avoidCalendarConflicts` is false and only the windows apply. The chat agent builds windows from what the user says ("any weekday after 4, next two weeks").

## Escalation contract (Q7)

**[derived D5]** In v1, escalation is **asynchronous**. The agent never keeps a receptionist on hold while waiting for the user. It records what it learned, closes the call politely and escalates. This is "run-to-completion is acceptable to start" from Q7, done without losing information.

```ts
type Escalation = {
  reason: "outside_rule_offers" | "no_availability" | "refused_ai" | "needs_user"
        | "limit_reached" | "inbound_needs_decision" | "wrong_business_unresolved";
  summary: string;                 // one line, generated from the structured outcome
  offers?: Slot[];                 // for outside_rule_offers
  suggestedActions: SuggestedAction[];
};

type SuggestedAction =
  | { kind: "accept_offer"; slot: Slot }           // → new revision: absolute window = exactly that slot
  | { kind: "widen_windows"; proposal: Window[] }
  | { kind: "switch_channel"; to: "email" | "phone" }
  | { kind: "raise_limits"; proposal: Partial<Limits> }
  | { kind: "call_yourself"; phone: E164 }          // honest fallback (I-12)
  | { kind: "give_up" };
```

- Each action other than `give_up` and `call_yourself` produces a **new Brief revision** with `created_by = 'escalation'`, shown as a pre-filled approval card. Approving it is a single tap, but it is still an approval (I-3).
- The user is notified through the inbox and email ([09](09-outcomes-and-proof.md#notifications)).
- Slots that were offered may be gone by the time the user responds. The new Brief's rule is exact ("that slot"), and if it's taken the result is a fresh escalation, not a guess.

**Later (not v1):** live mid-call escalation. It needs a sub-60-second response channel (for example push) and a "hold please" behaviour inside the limits. The escalation schema above is shaped so that this is an extra delivery mode, not a new contract.

## The cancel gate (Q20, I-10)

Most "cancel" intents are really "move" intents. The chat agent asks which one before drafting.

### Standalone cancellation
1. The Brief is approved → `awaiting_cancel_confirmation`.
2. The inbox shows a **second, specific confirmation**: "Cancel your appointment at Smile Dental, Clapham, Tue 14 Oct 09:30 (ref 4417)? This can't be undone by Faff." The button label repeats the date.
3. The confirmation row references the `appointment_id`, and only then → `queued`.
4. On the call, the agent must call `confirm_cancellation_allowed()` before asking for the cancellation.

### Reschedule (same business)
`verb = reschedule` is **paired by default**. The agent secures the new slot first, confirms it, and only then asks for the old slot to be released, all on the same call. If no acceptable new slot exists, the old appointment is left alone and the task escalates. No second confirmation is needed, because nothing is destroyed until something replaces it.

### Paired cancellation (different businesses)
"Move my eye test from Specsavers to Boots" = two linked Briefs: a **book** at Boots and a paired **cancel** at Specsavers (`cancel.mode = paired`). The second confirmation for the cancel is collected up front and stored with the condition "only if the Boots booking succeeds". The cancel task waits in `waiting_on_pair` and dispatches only when the booking task is `completed`.
