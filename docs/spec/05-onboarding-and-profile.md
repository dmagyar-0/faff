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

Free-text inputs (chat messages persisted into Briefs, `notesForAgent`, user-business notes) pass through `rejectSecrets()` (`packages/core/src/secrets.ts`), after NFKC normalisation so full-width digits can't slip past. On a match, the write is rejected and the chat agent explains why. It looks for:

- **Card numbers:** 13–19 digits starting 2–6, Luhn-valid, written as one block, in a printed grouping (4-4-4-4, 4-6-5…) or in blocks of three or more, separated by spaces, tabs, line breaks, dashes (hyphens, en or em dashes) or dots, including a card written with its expiry or security code straight after it. Numbers written side by side in other groupings (two phone numbers, a date and a time) aren't a card. A 13–19 digit reference written as one block that happens to start 2–6 and pass Luhn (about one in ten such references) is rejected too: accepted, since the user can write it with a space.
- **Bank details:** an IBAN that passes its checksum; a sort code with "sort code" just before it ("sort code: 20-00-00", "my sort code is 200000") or an 8-digit account number directly beside it; or "account number" (or "account", "acct", "a/c") followed by 8 digits, with or without "is" between; or, anywhere in one sentence, "account number" (or "acct", "a/c") and 8 digits (together, 4-4 or 2-2-2-2), or "sort code" (or "s/c") and a sort code written with dashes, dots or spaces. A bare `14-10-26` is a date, not a sort code; written directly beside an 8-digit number it reads as a sort code and account, and is rejected. An account at the business itself ("patient account 88213441") isn't bank details.
- **A secret with its value (M1-Q8a):** a secret's name followed by something that looks like its value ("my PIN is 4471", "password: hunter2", "password - hunter2", "password hunter2", "mother's maiden name is Smith", "my first pet was Rex", "place of birth is Leeds"). A bare mention passes: "they may ask for a PIN — say you don't have it" is exactly the note Faff wants. The value may also come later in the same sentence: a PIN-like number (3–8 digits on their own, not part of a date, time, price or phone number) anywhere in a sentence that names a PIN, passcode or one-time code, in either order ("if they ask for my PIN, it's 4471", "4471 is my PIN"); or, after a password or answer's name, a value after "it's", "tell them", "say", "is" or ":" ("if they ask for the password, it's hunter2"). An instruction after the name ("password — say you don't have it", "memorable word: tell them to call me") isn't a value. With nothing between the name and the value, the value must look like one (a digit or a symbol: "password hunter2", not "password recovery"), except for memorable words and security-question answers, which are ordinary words ("first pet Rex").
- **Length:** text over 20,000 characters (counted before NFKC, which can expand some characters) is refused (`too_long`) rather than scanned, so the scan's cost has a bound. No note or chat message Faff keeps comes near it.

Both a positive corpus and a false-positive corpus (phone numbers, dates, times, postcodes, booking references, NHS-style numbers, mentions without a value) are tests.

**Why this is structural rather than a policy:** if Faff never holds a security answer, it *cannot* be used to impersonate the user, whatever a prompt says.

**The user's own profile values (G21, M1-Q8b).** `notesForAgent` goes into the phone prompt, so a date of birth typed into the notes would reach the agent around `reveal_profile_field` (D3, I-7). At draft time the web server also runs `rejectProfileValues(notes, values)` with the user's profile values, which matches every usual spelling (a date of birth as `04/03/1985`, `4 March 1985` or `4th of March 85`; a postcode with or without its space; a phone number with `+44`, `0` or neither; an address with "St" for "Street"). Every field is checked except `existing_patient` and `preferred_name`: a preferred name is usually the first name the Brief already carries (`forPerson.firstName`), which a note may use. For the same reason a `full_name` equal to that first name isn't matched. Numbers must be a whole group of digits in the note and words whole words, so a longer reference or a neighbouring postcode doesn't match.

### The phone agent's view

The phone agent sees field *names* and whether each is allowed on this Brief. Values come only through `reveal_profile_field` once the callee's identity is confirmed (I-7). If a receptionist asks for something that isn't on the allow-list (for example an NHS number), the agent says it doesn't have that detail and the outcome becomes `needs_user`. It never guesses.

## Recording opt-out

`user_settings.record_calls` (default `true`). When `false`, calls still stream to speech-to-text so a transcript can be produced, but no audio is stored ([10](10-recording-and-retention.md)).
