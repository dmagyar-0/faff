# 02 — The Task Brief

The Brief is Faff's central object. The chat agent drafts it, the user approves it, and the executing agent carries it out. It is also the audit record and the unit of liability. It is designed as a **versioned, documented, public object** from day one, so that an MCP / external-LLM front end (Q15, handoff §3.2) is a later adapter that produces Briefs rather than a rewrite.

## Schema: `faff.brief/v1`

Source of truth: a zod schema in `packages/core/brief.ts`, exported as JSON Schema to `docs/spec/schemas/brief.v1.json` in CI. The TypeScript below is illustrative.

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
    address?: string;
    contact: ResolvedContact;      // see 08; carries evidence
  };

  channel: {
    chosen: "phone" | "email";
    reason: "user_memory" | "prefers_email_observed" | "no_phone_known" | "default_phone" | "user_override";
    emailFallbackToPhoneAfter?: Duration;           // Q29, default P2D
  };

  service: {
    description: string;           // "routine check-up and hygienist"
    durationMinutes?: number;
    practitioner?: string | null;  // null = any
    isExistingCustomer?: boolean;  // pinned from per-user memory
  };

  existingAppointment?: {          // required when verb is reschedule | cancel
    appointmentId: string;
    startsAt: string;
    reference?: string;
  };

  acceptance?: AcceptanceRule;     // required when verb is book | reschedule; see 06

  cancel?: {                       // required when verb = cancel
    mode: "standalone" | "paired";
    pairedWithBriefId?: string;    // the booking that must succeed first
  };

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
```

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
- The action posts `{briefId, revision, revisionHash}`. `revisionHash` is a SHA-256 of the canonical JSON of that revision. If it doesn't match (because the Brief changed since render), the approval is rejected and the card re-renders.
- The approval record stores who approved, when, the hash, and the rendered text the user saw.
- For `verb = cancel`, approval moves the task to `awaiting_cancel_confirmation`, not straight to the queue (I-10).

### What the user sees on the approval card

Verb and business, the channel and why it was chosen, the contact and its source, the service, the existing appointment (for reschedule or cancel), the acceptance rule in plain English, the exact profile fields the agent may say, the limits, and the capability reminder ("Faff will say it's an AI. Some businesses will decline.").
