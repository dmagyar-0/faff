# 02 — The Task Brief

The Brief is Faff's central object. The chat agent drafts it, the user approves it, and the executing agent carries it out. It is also the audit record and the unit of liability. It is designed as a **versioned, documented, public object** from day one, so that an MCP / external-LLM front end (Q15, handoff §3.2) is a later adapter that produces Briefs rather than a rewrite.

## Schema: `faff.brief/v1`

Source of truth: a zod schema in `packages/core/src/brief.ts`, exported as JSON Schema to [`docs/spec/schemas/brief.v1.json`](schemas/brief.v1.json) by `pnpm schema:write`. CI fails if the committed file differs from the zod schema. The TypeScript below is illustrative; where it and the zod schema disagree, the zod schema wins.

```ts
type Brief = {
  schema: "faff.brief/v1";
  briefId: string;                 // uuid, stable across revisions
  revision: number;                // 1, 2, 3… each edit creates a new revision
  userId: string;
  locale: "en-GB";                 // Q18: every Brief carries a locale
  timezone: "Europe/London";       // IANA; all times stored with offset

  verb: "book" | "reschedule" | "cancel";           // Q10

  business: {
    businessId: string;
    displayName: string;           // "Smile Dental, Clapham"
    kind: BusinessKind;            // G19: picks the opener's noun (patient, customer, client)
    address?: string;
    contact: ResolvedContact;      // see 08; carries evidence
    contactPolicy: {
      autoSwitchOnWrongNumber: boolean;  // Q39, default true; shown on the card
    };
  };

  forPerson: {
    firstName: string;             // G22: pinned at draft time for the identity step
  };

  channel: {
    chosen: "phone" | "email";
    reason: "user_memory" | "prefers_email_observed" | "no_phone_known" | "default_phone" | "user_override";
    emailFallbackToPhoneAfter?: { workingDays: number };  // Q29, G13: default { workingDays: 2 }
  };

  service: {
    description: string;           // "routine check-up and hygienist"
    durationMinutes?: number;
    practitioner?: string | null;  // null = any; who the agent asks for (G18)
    isExistingCustomer?: boolean;  // pinned from per-user memory
  };

  existingAppointment?: {          // required when verb is reschedule | cancel
    appointmentId: string;
    startsAt: string;
    reference?: string;
  };

  acceptance?: AcceptanceRule;     // required when verb is book | reschedule; see 06

  cancel?:                         // required when verb = cancel
    | { mode: "standalone" }
    | { mode: "paired"; pairedWithBriefId: string };  // the booking that must succeed first

  disclosure: {
    allowedFields: ProfileField[]; // pinned per Brief (Q21); see 05
  };

  limits: Limits;                  // Q27

  notesForAgent?: string;          // free text; context only, never grants authority
};

type Limits = {
  maxDialAttempts: number;         // default 3
  maxCallMinutes: number;          // talk + hold across all calls; default 30
  maxLifetime: Duration;           // wall clock from dispatch; default P7D
};

type BusinessKind = "dentist" | "gp" | "optician" | "physio" | "clinic" | "vet"
                  | "hair_and_beauty" | "garage" | "other";
type Slot = { start: string; end?: string; practitioner?: string };
type AppointmentRef = { appointmentId: string; startsAt: string; reference?: string };
type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
type Duration = string;            // ISO 8601 in D, H, M and S only: "P7D", "PT90M"
type E164 = string;                // "+442079460000"
```

### Shape rules (M1)

- **The verb decides which blocks exist.** The top level is a union on `verb`: `book` has `acceptance` and nothing about an existing appointment; `reschedule` has `acceptance` and `existingAppointment`; `cancel` has `existingAppointment` and `cancel`, and no `acceptance`. In the JSON Schema these are `oneOf` branches, so an external producer can check them without Faff's code.
- **Objects are closed.** An unknown key anywhere is an error, not silently dropped.
- **Every datetime is RFC 3339 with seconds and an offset** (`2026-10-05T09:00:00+01:00` or `…Z`). A local time names no instant, so it is rejected. Every phone number is E.164 (generic: the v1 UK-only rule, G12, is a `placeCall` guard). `Duration` uses days, hours, minutes and seconds only, because months and years have no fixed length.
- **`business.contact` is a union on `source`**, so `evidence` exists exactly when `source = "web_extract"`. It needs a phone number or an email address.
- **Rules the JSON Schema can't carry** are checked by `parseBrief` and listed in the schema's `description`: the chosen channel needs the matching contact value (`phone` needs `contact.phone`, `email` needs `contact.email`); an absolute window ends after it starts; a recurring window lists each weekday once and has `from ≠ to`; a cancel isn't paired with itself; `allowedFields` lists each field once; `limits.maxLifetime` is between `PT1H` and `P30D`; every UUID is lowercase (one id, one spelling, one hash); a datetime has at most 9 fractional-second digits; a practitioner name isn't only a title; a rule can't both require and avoid the same practitioner; every string is well-formed Unicode. `forPerson.firstName` goes into the phone prompt, so it is letters with the odd space, apostrophe, hyphen or full stop, and `business.displayName` is one non-blank line.
- **Practitioner (G18).** `service.practitioner` is who the agent asks for; `acceptance.practitioner` decides what may be accepted. A Brief where both are set and name different people (ignoring case, titles and punctuation) is rejected, as is one that asks for someone the rule's `avoid` list excludes.
- **New in v1 before any data existed (M1-Q7):** `business.kind` (G19), `forPerson.firstName` (G22, so the phone prompt gets the name from the Brief, not from outside it, I-3) and `emailFallbackToPhoneAfter` as working days (G13: spec 07 says working days, and a calendar `P2D` would fall back on a Sunday). All three are on the approval card.
- **Defaults** (`limits`, `contactPolicy.autoSwitchOnWrongNumber`, `emailFallbackToPhoneAfter`, `acceptance.bufferMinutes`) are applied by the parser. The revision hash covers the parsed Brief, so a producer that omits a defaulted field gets the same hash as one that writes the default out.

### Field rules

- **`notesForAgent` cannot expand authority.** The phone-agent prompt includes it under a heading that says so explicitly. The tool guards ignore it. It is scanned for secrets on write (I-6).
- **`disclosure.allowedFields` defaults** come from the profile's per-field defaults ([05](05-onboarding-and-profile.md)). The user can narrow the list for a single Brief. Widening it beyond the profile default is allowed but is highlighted in the approval UI.
- **`channel` is visible and can be overridden** before approval (Q29). The reason is always shown.
- **`business.contact` shows its evidence** (source URL and quoted text for web-found contacts). Per Q31 the user isn't asked to confirm it separately, but approving the Brief is informed approval.

## Limits

**[derived D6]** Defaults are 3 dial attempts, 30 call minutes and 7 days of lifetime. They are set in config and shown on the Brief. Hitting any limit → `escalated` with reason `limit_reached` (I-8). Money is out of scope (Q26), so the limits are counted in attempts and minutes. Pricing later becomes a conversion from minutes, not a schema change.

## Revisions

- Every edit, by the chat agent or the user, creates a new `brief_revisions` row. Revisions are never modified.
- A revision is **approved** or not. Only an approved revision can be dispatched.
- Escalations produce a **new revision** (for example, "accept Tuesday 14:30 exactly"). That revision needs a new approval, which the inbox UI makes a single tap ([06](06-escalation-and-acceptance.md)).
- `schema` is versioned. A future `faff.brief/v2` gets a migration function in `core`, and old revisions stay readable as they were written.

## Approval

**[derived D4]**

- Approval is an explicit **UI action on a rendered Brief card**, never a chat message. The chat agent can't produce an approval, even if the user types "yes, go".
- The action posts `{briefId, revision, revisionHash}`. `revisionHash` is `"sha256:"` plus the hex SHA-256 of the RFC 8785 (JCS) canonical JSON of the **parsed** revision (P3; `revisionHash` in `packages/core/src/canonical.ts`, with golden vectors). If it doesn't match (because the Brief changed since render), the approval is rejected and the card re-renders.
- The approval record stores who approved, when, the hash, and the rendered text the user saw.
- For `verb = cancel`, approval moves the task to `awaiting_cancel_confirmation`, not straight to the queue (I-10).

### What the user sees on the approval card

Verb and business (and the kind of business, which decides whether the agent says "patient", "customer" or "client"), who the task is for, the channel and why it was chosen, the contact and its source, whether Faff may switch to one other verified number if this one is wrong (Q39), the service, the existing appointment (for reschedule or cancel), the acceptance rule in plain English, the exact profile fields the agent may say, the limits, and the capability reminder ("Faff will say it's an AI. Some businesses will decline.").
