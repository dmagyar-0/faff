# 05 — Onboarding and Profile

## Sign-in (Q36)

- **Primary:** Google sign-in via Supabase Auth, requesting only `openid email profile` at sign-in.
- **Calendar is a separate, optional consent step** ([09](09-outcomes-and-proof.md#calendar-event)). Asking for calendar access at sign-in would bundle the heaviest permission in the product with the lightest one.
- **Fallback:** a magic-link email login, for users who don't use Google Calendar. Everything works without a calendar, because stated availability windows work on their own (Q12).

## Onboarding flow

1. Sign in.
2. **Capability statement** (I-12). A short, plain screen that must be acknowledged:
   - Faff always says it's an AI assistant calling on your behalf. Some businesses will decline to deal with it.
   - Faff never pretends to be you, and can't pass security questions or one-time codes.
   - Faff books, reschedules and cancels appointments. It doesn't handle banks, refunds or disputes.
   - Calls are recorded so they can be transcribed. Audio is deleted after 30 days. You can opt out (Q25).
3. **Profile basics:** full name (required, because the agent must name who it's calling for), then optional fields.
4. **Optional:** connect Google Calendar.
5. **Optional:** add businesses you already use ("my dentist is …"), which creates `user_businesses` rows and any existing appointments.
6. Into chat.

## Profile fields (Q21)

A **closed enum**. Adding a field is a schema migration plus a decision record, never a runtime choice.

| field | default disclose | notes |
|---|---|---|
| `full_name` | always (required) | Needed to say who the call is for |
| `preferred_name` | yes | |
| `date_of_birth` | yes | The usual identifier at dentists, GPs and opticians |
| `postcode` | yes | |
| `address_line` | no | |
| `contact_phone` | yes | So the business can reach the user directly |
| `contact_email` | no | Faff's own address is the default contact |
| `existing_patient` | per business | Lives on `user_businesses.is_existing_customer` |
| `nhs_number` | **no, and only storable after a separate opt-in** | Stored only after the user has read an explanation and opted in (`nhs_number_opt_in_at`). Never on a Brief by default. |

### Hard exclusions (I-6)

These have no enum value and cannot be stored anywhere:

- Payment details: card numbers, bank account and sort code.
- Anything that works as an authentication secret: memorable words, mother's maiden name, passwords, PINs, one-time codes, security-question answers.

Free-text inputs (chat messages persisted into Briefs, `notesForAgent`, user-business notes) pass through `rejectSecrets()`, which uses card-number (Luhn), sort-code/account and keyword patterns. On a match, the write is rejected and the chat agent explains why. **Why this is structural rather than a policy:** if Faff never holds a security answer, it *cannot* be used to impersonate the user, whatever a prompt says.

### The phone agent's view

The phone agent sees field *names* and whether each is allowed on this Brief. Values come only through `reveal_profile_field` once the callee's identity is confirmed (I-7). If a receptionist asks for something that isn't on the allow-list (for example an NHS number), the agent says it doesn't have that detail and the outcome becomes `needs_user`. It never guesses.

## Recording opt-out

`user_settings.record_calls` (default `true`). When `false`, calls still stream to speech-to-text so a transcript can be produced, but no audio is stored ([10](10-recording-and-retention.md)).
