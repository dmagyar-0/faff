# 04 — Data Model

Postgres (Supabase). Row-level security on every user-owned table (`user_id = auth.uid()`). The worker and the tools server use a service role scoped by table grants. Times are `timestamptz`, and phone numbers are E.164 text.

## Two memory tiers (Q13, Q19)

| | Per-user tier | General tier |
|---|---|---|
| Example | "David's dentist is Smile Dental, patient since 2019" | "Smile Dental's number is …, press 2 for bookings, prefers email" |
| Trust | **Trusted.** The user authored or confirmed it. | **Observations only.** Never treated as fact (I-5). |
| Mutability | The user edits it freely | Append-only |
| Personal data | Yes, RLS-protected | **Never [derived D10]** |

### Per-user tier: `user_businesses`

| column | type | notes |
|---|---|---|
| user_id, business_id | uuid | PK |
| relationship | text | "patient since 2019", "registered" |
| is_existing_customer | bool | pinned into Briefs |
| preferred_contact | jsonb | `{phone?, email?}`. If present, overrides lookup, because the user supplied it |
| preferred_practitioner | text null | |
| updated_at | timestamptz | |

### General tier: `business_observations`

Append-only (I-5). There are no UPDATE/DELETE grants, and a `BEFORE UPDATE OR DELETE` trigger raises an error.

| column | type | notes |
|---|---|---|
| id | bigint identity | monotonic |
| business_id | uuid | |
| kind | enum | `phone_number`, `email_address`, `prefers_email`, `ivr_path`, `opening_hours`, `number_wrong`, `reached_ok`, `hold_minutes`, `refused_ai`, `accepted_ai`, `booking_lead_time`, `email_reply_latency` |
| value | jsonb | shape per kind, validated by zod (`packages/core/src/observations.ts`). No shape has a free-text field (D10); an IVR spoken step is at most two short lowercase words ("new patients") |
| observed_at | timestamptz | when it was true |
| source_kind | enum | `call`, `email`, `web_extract`, `user_report` |
| source_ref | text | call_id / email message_id / URL |
| evidence_quote | text null | required for `web_extract` (I-11) |
| task_id | uuid null | provenance |

**[derived D10]** Observations describe businesses, never users. They never contain names, DOBs, appointment details or transcripts of the user's data. The observation writer takes typed input only (no free-text passthrough from transcripts). Two reasons: (a) the general tier is shared across all users, and (b) it keeps the moat free of personal data, so a deletion request never has to touch it.

### Derived cache: `business_profile_cache`

| column | notes |
|---|---|
| business_id | PK |
| derived | jsonb, e.g. best phone, email preference, IVR hint, typical hold |
| derived_from_max_id | the highest observation id it considered |
| derived_at, expires_at | TTL, default 7 days |

Written only by `deriveBusinessProfile(observations, now)`, a **deterministic function** in `core` (`packages/core/src/profile-derive.ts`) with recency weighting. The same observations in any order give the same profile (a property test checks this); ties in `observed_at` are broken by `id`, and rows dated after `now` are ignored.

- **Best phone:** the most recent `reached_ok` number with no newer `number_wrong` for that number, reached under 180 days ago. **Best email:** the most recent `reached_ok` address under 180 days old.
- **IVR hint, opening hours, AI reception** (accepted or refused): the most recent observation of each.
- **Typical hold:** the median of the last 10 `hold_minutes`.

It takes one business's observations (the caller filters by `business_id`). `derived_from_max_id` is the highest id it considered, so a row dated after `now` isn't counted until it is due. No LLM writes to it. When it expires it is **thrown away and recomputed, never corrected in place**. Agents that need nuance get the raw recent observations, not the cache.

## Core tables

### `businesses`
`id, display_name, kind, address, postcode, website, country ('GB'), locale ('en-GB'), created_at`. Identity only. Contact details live in observations. `kind` is the Brief's `business.kind` (G19), which picks the opener's noun. `website` (G20, nullable) is the business's own domain: a web-found contact cited there, or on any subdomain of it, counts as first-party for Q39 ([08](08-business-resolution.md#after-a-wrong-number)). It must be a domain the business owns, never a shared host (a social network, a site builder, a directory), or that whole host would count as the business's own; M2 rejects a website with a path or on a known shared host.

### `profile_fields` — see [05](05-onboarding-and-profile.md)
`user_id, field (enum), value (encrypted), disclose_by_default bool, updated_at`. PK `(user_id, field)`.

### `appointments`
| column | notes |
|---|---|
| id, user_id, business_id | |
| starts_at, ends_at | |
| service, practitioner, reference | |
| status | `booked`, `cancelled`, `superseded` |
| supersedes_id | reschedule chain |
| source | `faff_task`, `user_entered` (so existing appointments can be rescheduled or cancelled) |
| source_task_id | null for user-entered |
| calendar_event_id | Google event id, if written |

### `briefs` / `brief_revisions`
- `briefs`: `id, user_id, current_revision, created_at`.
- `brief_revisions`: `brief_id, revision, body jsonb (validated faff.brief/v1), schema, revision_hash, created_by ('chat_agent'|'user'|'escalation'), created_at`. Immutable.
- `brief_approvals`: `brief_id, revision, revision_hash, approved_at, rendered_text`.
- `cancel_confirmations`: `brief_id, revision, appointment_id, confirmed_at`.

### `tasks` / `task_events`
- `tasks`: `id, user_id, brief_id, approved_revision, state, attempts_used, call_seconds_used, dispatched_at, lifetime_expires_at, escalation jsonb null, failure_reason null, paired_task_id null`.
- `task_events` (append-only): `id, task_id, from_state, to_state, event, payload, at`.

### `calls`
`id, task_id, attempt_no, provider, direction ('outbound'|'inbound'), from, to, started_at, answered_at, ended_at, hold_seconds, outcome jsonb, identity_confirmed_at, audio_path null, audio_delete_after, transcript jsonb`.

### `field_reveals` (audit of I-7)
`call_id | email_id, field, allowed bool, at`. Refused reveals are logged too.

### `email_messages`
`id, task_id, direction, message_id, thread_token, from, to, subject, body_text, parsed jsonb, at`.

### `inbox_items`
`id, user_id, task_id, kind ('approve_brief'|'confirm_cancel'|'escalation'|'inbound_followup'|'report'), payload, created_at, resolved_at, resolution`. See [09](09-outcomes-and-proof.md).

### `verified_caller_ids`
`e164, provider, verified_at`. `placeCall` rejects any number not in this table (I-4).

## Deletion

Deleting a user account cascades to all of their rows above except `business_observations`, which by D10 contains none of their personal data. Audio is deleted immediately and transcripts are deleted with the account.
