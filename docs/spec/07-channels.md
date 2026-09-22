# 07 — Channels: Phone, Email and Inbound

Email is both a **parallel channel** (for businesses that prefer it) and a **supporting channel** (confirmations and chasers). It is not an independent capability (Q16).

## Channel resolution (Q29)

`resolveChannel(business, userMemory, recentObservations) → { chosen, reason }` is a deterministic function in `core`:

1. The user's own `preferred_contact` for this business decides → `user_memory`.
2. Otherwise, if the most recent preference-relevant observation (`prefers_email`, or an `email_reply_latency` showing replies within 2 working days) is less than 180 days old and favours email, **and** an email address is known → `prefers_email_observed`.
3. Otherwise, if no phone number is known but an email address is → `no_phone_known`.
4. Otherwise → phone, `default_phone`.

The chosen channel and its reason appear on the Brief, and the user can override it before approving (`user_override`).

**Email fallback:** if the channel is email and no reply that can be acted on arrives within `emailFallbackToPhoneAfter` (default 2 working days), the task switches to phone. The switch is logged and counts towards the limits. If there's no phone number, the task escalates instead.

## Outbound email

- **Sender:** a Faff address, never the user's own mailbox (Q17). `From: "Faff for David M." <bookings@<faff-domain>>`. `Reply-To` is a per-task token address, `t-<token>@reply.<faff-domain>`, so replies thread back to the task.
- **Fixed signature block (Q17, I-1):** identical on every email, appended by the renderer and impossible for the agent to change:

  > —
  > Sent by Faff, an AI assistant acting on behalf of the person named above. Faff is not that person and cannot answer security questions for them. Reply to this email and Faff will pass it on. faff.<tld>/about-this-email

  The *tone* can be light. The identity can't. Headers are honest: no display-name tricks that make it look like it came from the user.
- **Body** is written by the email agent from the Brief. Profile values enter only through `reveal_profile_field`, with the same allow-list.
- **[derived D2] Established addresses.** An address with no `reached_ok` observation (a successful prior exchange) is *unestablished*. The first email to it includes only the user's name and the request. Other allowed fields (such as date of birth) are sent after the business replies. This is Q35's identity check applied to email: a citation-verified address can still be out of date.
- **Deliverability:** SPF, DKIM and DMARC are set up on the Faff domain before any real email is sent.

## Chasers

If a call ended with `no_contact` and an email address is known, the worker may send **one** polite chaser email alongside the redial schedule. That counts as a supporting use of email, not a channel switch.

## Inbound path (Q23)

This isn't optional. Ofcom's CLI rules (I-4) mean receptionists will call the Faff number back, and the Faff address means businesses will reply to emails.

### Inbound calls
- The outbound caller ID routes inbound calls to a **voicemail greeting** that discloses itself (I-1): "You've reached Faff, an AI assistant that calls businesses on behalf of its users. Please leave a message with the name of the person it's about, and it'll be passed on."
- Voicemail → transcription → matched to a task by the caller's number (against the `to` numbers of recent calls) and the name mentioned → an `inbound_followup` inbox item.
- Nothing answers inbound calls live in v1. A live inbound agent would be a second agent with no Brief in front of it (Q23b was rejected).

### Inbound email
- A webhook receives the email → `email_messages` → an LLM parser extracts `{ offersSlots?, confirms?, asksFor?, declines? }` into a typed structure.
- **Auto-act carve-out:** if a reply offers a slot that `evaluateAcceptance` accepts for an open task in `waiting`, and the verb isn't cancel, Faff accepts (by replying, or by calling if they asked for a call) and then reports. The user already authorised this shape of answer.
- Anything else → `inbound_followup` inbox item with suggested actions. One tap creates a new Brief revision (I-3).
- Unmatched inbound email (no task token) → a human-review queue, never auto-actioned.

### Callbacks outside the auto-act rule
If a voicemail says "we can do Thursday at 3, call us back to confirm" and Thursday 15:00 fits the rule, the auto-act carve-out applies: Faff redials to confirm, and the redial counts towards the limits. Otherwise the message becomes an inbox item.
