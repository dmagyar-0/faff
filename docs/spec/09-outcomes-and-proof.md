# 09 — Outcomes, Proof and Notifications

When a booking succeeds, three things happen (Q14): a **report** to the user, a **calendar event**, and a **confirmation email to the business**. They are enqueued together when the task reaches `completed`, and each is retried on its own.

## Report (Q37)

An inbox item of kind `report`, which renders as:

1. **Structured outcome, at the top.** Booked, rescheduled, cancelled or not. When, where, who with, the reference number, and **exactly which profile fields were disclosed** (from `field_reveals`, not from the agent's own account).
2. **Proof status:** calendar event ✓/✗, confirmation email sent ✓/✗/not possible (no email address known).
3. **Full transcript** below, with speaker labels. Raw, not summarised. An LLM summary is exactly the kind of paraphrase the user distrusts (Q19 spirit).
4. **Audio player** while the audio still exists (30 days, [10](10-recording-and-retention.md)), with the deletion date shown.

Failed or escalated tasks get the same report shape, with the escalation actions at the top.

## Calendar event (Q22)

**[derived D7]** The constraint "write only to events Faff created" is enforced **by the OAuth scope**, not just by application code:

- `https://www.googleapis.com/auth/calendar.app.created`: Faff creates a secondary calendar called **"Faff"** and can only manage calendars it created, and their events. It has no write access to the primary calendar.
- `https://www.googleapis.com/auth/calendar.freebusy`: reads busy and free times for `avoidCalendarConflicts` (Q12), without event titles or details.

*Implementation note: verify these scope names and behaviour against Google's current documentation before building. If `calendar.app.created` turns out to be unsuitable, the fallback is `calendar.events` with every write filtered to events carrying `extendedProperties.private.faffTaskId`. That fallback enforces the rule in code only, and needs a new decision record.*

Event contents: title `"{service} — {business}"`, location = business address, description = reference number, a "booked by Faff" line and a link to the report. On reschedule the event is updated; on cancel it is deleted. Faff can only touch events it created, because of the scope.

**Without a calendar connection:** the report offers a `.ics` download instead. As noted in Q22, this isn't proof, only convenience.

## Confirmation email to the business

From the Faff address, with the fixed signature (I-1):

> Subject: Confirming appointment — David E., Tue 14 Oct 09:30
>
> Thanks for your help on the phone today. Confirming: routine check-up for David E., Tuesday 14 October at 09:30 with Dr Patel, reference 4417. If anything here is wrong, just reply to this email.

- It contains only fields that were **actually disclosed on the call**, never more.
- It requires a known email address for the business. If there isn't one, it's skipped and the report says so.
- Replies go through the inbound path ([07](07-channels.md#inbound-email)). A reply saying "actually it's 10:30" becomes an inbox item. It is never silently written to the calendar.

## Notifications (Q32)

- **The in-app inbox is the source of truth.** Every item that needs a decision (`approve_brief`, `confirm_cancel`, `escalation`, `inbound_followup`) and every `report` lives there.
- **Email notification** to the user's sign-in address, carrying a deep link. It contains no transcript content and only a one-line summary ("Smile Dental offered times outside your windows — choose one").
- Notification emails come from a separate `notifications@` sender so they are never confused with business-facing email.
- Later (not v1): web push, and a native app.
