# M1 — `core` domain

**Status:** accepted with every default (owner, 2026-09-24) · **Date:** 2026-09-24 · **Parent:** [implementation plan §2.1, §4](../implementation-plan.md#21-packagescore-pure-domain-logic-no-io) · **Depends on:** [M0](M0-foundations.md)

M1 writes `packages/core`: every rule in the spec that can be decided without I/O, as pure functions with unit and property tests. It is the package that decides correctness. The worker, the tools and the graders all call into it, so a bug here is a bug everywhere, and a rule that's right here is right everywhere.

M1 is also where the spec's loose ends become concrete. A zod schema can't say "a date, roughly"; a transition table can't leave a state with no way out. [§5](#5-gaps-found-while-planning) lists the ones found while planning, and [§8](#8-questions-for-the-owner) the decisions they need.

**Exit criteria (from the plan):** ≥95% branch coverage on `acceptance`, `task-machine`, `limits`, `secrets`, `citation`; DST and midnight-crossing cases pass. The checkable version is in [§7](#7-exit-criteria).

---

## 1. Scope

### In: the modules from plan §2.1

`brief`, `canonical`, `task-machine`, `acceptance`, `channel`, `profile-derive`, `secrets`, `citation`, `limits`, `locale/en-GB`, and the Brief JSON Schema export.

### In: pure logic the plan's table missed

Each of these is either named by the spec as a `core` function, or is pure logic that M3/M4 would otherwise put in an impure package where it's harder to test.

| Module | Why it belongs in M1 |
|---|---|
| `contact-switch.ts` — `mayAutoSwitchContact` | **Named by the spec** as a pure `core` function ([08](../../spec/08-business-resolution.md#after-a-wrong-number), Q39). Missing from plan §2.1 |
| `outcome.ts` — `Outcome` schema, `validateOutcome` | The state machine's main input. P5 (reject a `disclosedFields` mismatch) is a pure set comparison |
| `escalation.ts` — `escalationFromOutcome`, `applySuggestedAction` | Builds the escalation payload and the next Brief revision. Must be TypeScript, not SQL: see [§5 C1](#corrections-to-the-implementation-plan) |
| `observations.ts` — zod value schema per `kind` | Spec 04 says "shape per kind, validated by zod". Typed input is how D10 (no personal data in the general tier) is enforced |
| `disclosure.ts` — `mayRevealField(brief, field, identityConfirmedAt)` | The I-7 decision. `tools.reveal_profile_field` (M4) wraps it with I/O and the audit write |
| `identity-match.ts` — `matchBusinessIdentity(heard, business, aliases)` | G9's deterministic token-set match. Threshold is provisional until the M6 noise scenarios tune it |
| `render/` — Brief card text, acceptance rule in plain English, escalation summary line | The approval stores "the rendered text the user saw" (spec 02); the phone prompt carries "the acceptance rule in words" (spec 01). Both must come from one deterministic renderer |
| `heard-date.ts` — `checkHeardDate` | The "Tuesday the 14th when the 14th is a Wednesday" scenario (spec 11) needs a code check, not a hope. See [§3.4](#34-acceptancets-i-9) |

### Out

- Anything with I/O: fetching pages for citations (M7, `agents/lookup`), HTML-to-text (M7), DB writes, the tools' HTTP layer (M4).
- The phone and chat prompts themselves (M3/M4). M1 supplies the strings and renderers they're built from.
- Tuning `identity-match` thresholds (M6).
- A `faff.brief/v2` migration function. There's no v2; the hook for one is a `parseBrief` that switches on `schema`.

---

## 2. Cross-cutting choices

- **Allowed runtime dependencies** (the M0 dependency check enforces this list): `zod` (v4, for its built-in `z.toJSONSchema`), `temporal-polyfill`, `@noble/hashes` (sync SHA-256 that runs identically in Node, the browser and edge runtimes), `canonicalize` (RFC 8785 reference implementation). Dev only: `fast-check`.
- **Time.** Every function that needs "now" takes `now: Temporal.Instant` as an argument. All wall-clock maths goes through `ZonedDateTime` in the Brief's `timezone`, with `disambiguation: "compatible"`. Temporal is imported from one internal module (`time.ts`), so moving to native Temporal is a one-line change.
- **Results, not throws.** Domain outcomes are returned values (`{ ok: false, reason }`), because the reasons are data: they go into `task_events`, escalations and tool responses. Throwing is reserved for programmer errors (an unparsed Brief reaching a function that requires a parsed one).
- **Reason codes are string-literal unions**, exported, so the worker, the tools and the graders match on the same values.

---

## 3. Module design

Signatures are sketches; the PRs settle the details.

### 3.1 `brief.ts`

- `BriefV1`: the zod schema for `faff.brief/v1`. The top level is a **`z.discriminatedUnion("verb", …)`**, not a `superRefine`, so the cross-field rules (`acceptance` required for book/reschedule, `existingAppointment` required for reschedule/cancel, `cancel` required for cancel) appear in the exported JSON Schema as `oneOf`. The Brief is meant to be a public object for a future MCP front end (spec 02); an external producer should be able to validate against the JSON Schema alone.
- Rules that JSON Schema can't express stay as refinements and are listed in the schema's `description`: `cancel.pairedWithBriefId` present iff `mode = "paired"`; `contact.evidence` present iff `source = "web_extract"`; `channel.chosen = "email"` needs `contact.email`, `"phone"` needs `contact.phone`; every datetime is RFC 3339 **with an offset**; E.164 on every number (generic E.164: the UK-only rule, G12, is a `placeCall` guard, not a schema rule, for locale discipline).
- Types the spec uses but never defines are defined here: `Slot` (`{ start, end?, practitioner? }`), `AppointmentRef`, `Duration` (ISO 8601), `Weekday`, `E164`.
- `parseBrief(unknown) → Result<Brief>` switches on `schema`, so v2 can be added without touching callers.
- `toJsonSchema()` feeds `pnpm --filter @faff/core schema:write`, which writes `docs/spec/schemas/brief.v1.json`. CI regenerates it and fails on a diff.
- Proposed additions to v1 are in [§8](#8-questions-for-the-owner) (M1-Q7). v1 has no data yet, so this is the cheapest time to add fields.

### 3.2 `canonical.ts` (P3)

- `canonicalJson(x) = JCS(x)` per RFC 8785.
- `revisionHash(brief) = "sha256:" + hex(SHA-256(UTF-8(canonicalJson(BriefV1.parse(brief)))))`. **It hashes the parsed Brief**, after zod defaults are applied, so two producers that differ only in omitted defaulted fields get the same hash.
- **Golden vectors:** `packages/core/fixtures/brief-hash/*.json`, each a Brief and its expected hash, committed. They include key-order shuffles, Unicode (a `ł` in a business name, an emoji in notes), numbers (`30` vs `30.0`), and an absent optional field vs one set to `null` (they must differ; `exactOptionalPropertyTypes` from M0 stops `undefined` sneaking in).
- The RFC 8785 appendix vectors are tested too, so a library swap can't silently change bytes.

### 3.3 `task-machine.ts`

`transition(task, event, ctx) → { next, effects[] } | Rejection`, where `ctx` carries `now`, the approved Brief, usage counters, and the other inputs a guard needs. Effects are data: `schedule_wake(at)`, `create_inbox_item`, `write_observations`, `enqueue_proof_jobs`, `end_live_call_gracefully`, `record_contact_switch`, `notify_user`. The worker (M4) runs them in the transaction that appends to `task_events`.

What M1 encodes, beyond the spec 03 table:

- **G1 (default):** there is no `draft` task state. Tasks are born at approval in `queued` or `awaiting_cancel_confirmation`.
- **G3 (default):** usage counters persist across revisions; a new revision's limits are totals.
- **G4 (default):** `waiting --voicemail.received(in_rule)--> queued` (redial to confirm; counts to limits), mirroring the email auto-act row.
- **G5:** every entry to `escalated` sets `escalation_expires_at` and a reminder wake. The spec's lifetime row says 48h; G5 proposes 7 days. See M1-Q2.
- **Outcomes the table doesn't route** (see [§5 G14](#new-gaps)): `no_availability → escalated(no_availability)`, `needs_user → escalated(needs_user)`, `no_contact(closed) → waiting` (next opening window), and the "no attempts left" branch of every `→ waiting` row becomes `→ escalated(limit_reached)`.
- **Calls that end without `end_call`** (callee hangs up, provider error, watchdog cut): the worker sends `call.ended` with a system outcome `{ kind: "dropped", by: "callee" | "provider" | "watchdog" }`, treated as `no_contact` for redial purposes. M1-Q6.
- **Late events on terminal tasks** (a `call.ended` after `user.withdraw`) are accepted as `absorbed`: usage is still counted, state doesn't move. Withdraw during `in_progress` emits `end_live_call_gracefully` and moves to `withdrawn` (I-4: never abandoned).
- **Approve guards:** a new revision approved in `escalated` must have the same `briefId`, a higher revision number and the **same verb**. Approving a newer revision while `queued`/`in_progress`/`waiting` is rejected (`task_in_flight`); the user withdraws or waits for an escalation.
- **"Any active"** is defined explicitly as `{queued, in_progress, waiting}`. `limit.reached` never fires in `in_progress` directly: the watchdog ends the call and the resulting `call.ended` is checked against limits.

**Tests.**
1. A hand-written table test, one row per spec 03 row plus the additions above, written from the spec, **not** generated from the implementation's own table (that would be a tautology).
2. **Exhaustiveness:** every `(state, event)` pair in the cross product returns a transition or a typed `Rejection`, never a throw and never `undefined`.
3. **Model-based property test** (fast-check commands) on random event sequences, asserting:
   - terminal states are absorbing;
   - a `cancel` task never reaches `in_progress` without a `user.confirm_cancel` naming the Brief's `appointmentId` earlier in its history (I-10);
   - no `worker.start` succeeds once any limit is exhausted (I-8);
   - every entry to `escalated` carries an `Escalation` with at least one suggested action and an expiry;
   - `queued` is only ever entered from approval, confirmation, pair completion, a timer or an in-rule auto-act (I-3: nothing else can start work).

### 3.4 `acceptance.ts` (I-9)

`evaluateAcceptance(rule, slot, busy[], ctx) → accept | reject(reason) | outside_rule(reasons[])`, `ctx = { now, timezone, defaultDurationMinutes, existingAppointment? }`.

The spec doesn't say how `reject` differs from `outside_rule`. Proposed (M1-Q4):

- **`reject`**: the slot isn't a real, evaluable offer. `invalid_slot` (end ≤ start, no offset), `in_past`, `inconsistent_date` (from `checkHeardDate`). The agent clarifies with the callee; nothing is recorded as an offer.
- **`outside_rule`**: a real offer that the user's rule doesn't allow. `not_in_window`, `calendar_conflict`, `too_soon` (`minNoticeHours`), `practitioner_mismatch`, `practitioner_avoided`, `practitioner_unknown`. The agent calls `record_offer`; these become the escalation's `offers`.

Semantics:

- **Windows are a union.** The slot must be contained in the union of all window occurrences, so a slot spanning two adjacent windows is accepted.
- **Recurring windows** are wall-clock `from`/`to` in the Brief's timezone. `from > to` means the window crosses midnight and belongs to the day it starts on. `between` is a pair of **inclusive local dates** (M1-Q5).
- **DST.** A window edge that doesn't exist (01:30 on 29 Mar 2026) resolves forward; one that exists twice (01:30 on 25 Oct 2026) resolves to the earlier. Containment is always compared on instants, so the same slot written as `+00:00` or `+01:00` gets the same answer.
- **Slot without an end** gets `start + defaultDurationMinutes` (the service's duration, else 30).
- **Calendar.** When `avoidCalendarConflicts`, each busy interval is widened by `bufferMinutes` (default 30) on both sides. For a reschedule, a busy block that exactly matches the existing appointment is dropped first. Free/busy returns no IDs, so an exact match is the best available signal; without this, the old appointment blocks the slots next to it.
- **Practitioner** names are compared after case-folding and stripping titles (Dr, Mr, Mrs, Ms, Miss, Mx) and punctuation.
- **Choosing among accepted slots.** `pickPreferred(rule, acceptedSlots)` applies `preference` (earliest, latest, closest to). Whether M4's tools *require* the agent to use it is M1-Q9.

**Property tests** (fast-check, arbitrary instants across 2026–2028 including both DST transitions):

- same instant, any offset → same result;
- adding a busy interval never turns a non-accept into `accept`; adding a window never turns `accept` into anything else (monotonicity);
- a slot inside an absolute window with no other constraints → `accept`;
- total: never throws for any schema-valid input.

**Named example tests** (the exit criteria check these by name): spring-forward and fall-back days for absolute and recurring windows; a 22:00–02:00 window on each DST night; a slot ending exactly at a window edge (accepted) and one minute over (not); a slot at 23:30 on the `between.end` date (accepted); two adjacent windows; buffer exactly touching a busy block.

### 3.5 `heard-date.ts`

`checkHeardDate({ start, heard: { weekday?, dayOfMonth?, month? } }, timezone) → ok | inconsistent(detail)`. The LLM converts speech to an ISO datetime and may silently pick one reading of "Tuesday the 14th". Carrying what was heard alongside the ISO value lets code catch the contradiction. It's cheap to add in M1; whether `propose_slot` takes the `heard` field is decided in M4.

### 3.6 `limits.ts` (I-8, I-4)

- `remaining(limits, usage, dispatchedAt, now) → { dials, callSeconds, lifetimeUntil }`.
- `mayDial(ctx) → ok | notBefore(at, reason) | exhausted(which)`. Checks attempts, minutes, lifetime, opening hours, and **no dial within 5 minutes of a human-answered call**.
- `nextRedialAt(history, openingHours, now)`: 20 min, then 2 h, then 2 h for any further attempts a raised limit allows; always moved into the next opening window. Opening hours come from observations, else Mon–Fri 09:00–17:30 in the Brief's timezone. An IVR "we're closed" counts as an attempt and schedules into the next window.
- `callBudget(remainingSeconds) → { closeAt, hardStopAt }`: the watchdog starts the graceful close **60 s before** the limit and the provider's `maxDurationSec` is the limit itself. The spec calls the provider limit a backstop; if it were set above the limit, `limits_respected` would fail whenever the watchdog missed.
- `addWorkingDays(instant, n, timezone, holidays)` for the email fallback (M1-Q3). Holidays are an argument; the en-GB list lives in `locale/en-GB`.

### 3.7 `channel.ts`

`resolveChannel({ userMemory, observations, knownContacts }, now) → { chosen, reason }`, spec 07 rules 1–4 in order. The 180-day freshness and the "reply within 2 working days" test use `addWorkingDays`. `user_override` is never produced here; the UI sets it.

### 3.8 `profile-derive.ts` and `observations.ts` (I-5, D10)

- `observations.ts`: one zod schema per `kind` (`phone_number: { e164 }`, `ivr_path: { steps: DtmfOrPhrase[] }`, `opening_hours: { weekly: …, source }`, `hold_minutes: { minutes }`, …). **No schema has a free-text field**, which is how the writer "takes typed input only" (D10). A test walks every schema and fails if any string field lacks a format, enum or length bound that rules out prose.
- `deriveBusinessProfile(observations, now) → { derived, derivedFromMaxId }`. The best phone is the most recent `reached_ok` number with no newer `number_wrong`, under 180 days old. Typical hold is the median of the last 10 `hold_minutes`. The IVR hint and opening hours are the most recent. Deterministic: property test that shuffling the input order doesn't change the output.

### 3.9 `secrets.ts` (I-6)

`rejectSecrets(text) → ok | { kind, span }`, after NFKC normalisation (full-width digits can't slip past). Detectors:

- **Card:** 13–19 digits, any grouping of spaces or dashes, Luhn-valid.
- **Bank:** a sort code (`nn-nn-nn` or `nnnnnn`) **near** an 8-digit account number or the words "sort code"/"account". A bare `14-10-26` is a date, not a sort code.
- **Secret keywords with a value:** "password", "PIN", "memorable word", "mother's maiden name", "security answer", "one-time code", "CVV" and so on, **followed by something that looks like a value** ("my PIN is 4471", "password: …"). A bare mention ("don't give them my PIN") passes.

The spec says "keyword patterns"; requiring a value next to the keyword is a narrowing, flagged as M1-Q8. It stops the chat agent refusing to write a note like "they may ask for a PIN — say you don't have it", which is exactly the note we want.

**Tests:** a positive corpus (standard test card numbers in every grouping, sort code + account pairs, keyword-value phrasings) and a **false-positive corpus** that must pass: UK phone numbers, dates in every common format, times, postcodes, booking references, NHS-style 10-digit numbers.

### 3.10 `citation.ts` (I-11)

- `normalisePhone(text, defaultRegion = "GB") → E164 | null`: `+44 20 7946 0000`, `020 7946 0000`, `(020) 7946-0000`, `+44 (0)20 7946 0000` all map to the same value.
- `normaliseText(text)`: NFKC, collapse all whitespace (NBSP, zero-width, line breaks) to single spaces, unify dashes and quotes.
- `citationHolds(candidate, quote, pageText) → ok | fail(reason)`: the normalised quote appears in the normalised page, **and** the candidate appears in the quote (phones compared as E.164 of each phone-like run in the quote; emails compared with a case-insensitive domain and an exact local part).
- `pageNamesBusiness(pageText, displayName, postcode?, address?)` for Q39 condition 4.
- `isFirstPartySource(url, businessDomain?)`: true for the business's own domain or the NHS service directory (the list lives in `locale/en-GB`).

Obfuscated addresses (`info [at] …`) fail the check. That's correct: I-11 would rather discard a real address than dial or email something the page didn't literally say.

### 3.11 `contact-switch.ts` (Q39)

`mayAutoSwitchContact({ brief, task, newContact, observations, business, usage, now }) → ok | reason`, the six conditions of spec 08 in order, each with its own reason code so the escalation can say which one failed. Built on `citation.ts` and `limits.ts`. Branch coverage target ≥95% (added to the exit criteria: it's an I-3 guard).

### 3.12 `disclosure.ts` and `identity-match.ts` (I-7, G9)

- `mayRevealField(brief, field, identityConfirmedAt) → ok | refused(reason)`: `not_allowed_on_brief`, `identity_not_confirmed`. It refuses `full_name` before identity too ([08](../../spec/08-business-resolution.md#callee-identity-check-q35)).
- `matchBusinessIdentity(heard, { displayName, location }, aliases) → match | mismatch | unclear`: case-fold, strip generic words ("the", "practice", "surgery", "ltd"), token-set similarity against the display name and every alias. Provisional thresholds, with a test table of speech-recognition-style mishearings ("smile dent all" → match, "Bright Smile" → unclear).

### 3.13 `outcome.ts` and `escalation.ts`

- `Outcome` zod schema (spec 03) plus the system `dropped` kind.
- `validateOutcome(outcome, brief, reveals) → ok | error`: kind matches the verb (a `book` Brief can't end `rescheduled`); `disclosedFields` equals the set of **allowed** reveals in the log (P5, stricter than spec 03's "flag"); `booked` needs a `startsAt` with an offset.
- `escalationFromOutcome(outcome, brief) → Escalation`, with the summary line from `render/`.
- `applySuggestedAction(brief, action) → Brief`: the next revision (`revision + 1`), e.g. `accept_offer` → one absolute window exactly equal to the slot. Written in TypeScript so the hash is computed by `canonical.ts`.

### 3.14 `locale/en-GB.ts` and `render/`

- The disclosure opener: `"Hi, I'm an AI assistant calling on behalf of a {noun} — is this {businessName}{, in location}?"`. Noun by business kind (patient, customer, client). The voicemail greeting and the capability statement, verbatim from the spec.
- The **email signature**, verbatim from spec 07, with the domain as a parameter (no domain exists yet, Q-D). A test checks the rendered signature bytes against a fixture.
- Date and time speech ("Tuesday the fourteenth of October at half past nine"), the E&W bank holiday list for 2026–2028, NHS directory domains, the `+44` dialability check (G12).
- `render/briefCard(brief) → { sections, text }`, `render/acceptanceRule(rule) → string`, `render/escalationSummary(escalation) → string` (moved to PR 1.4, next to the `Escalation` type it renders, with its own snapshot). Snapshot tests on a fixture Brief per verb.

Every string here is a legal artefact under spec 12. The file gets a `CODEOWNERS` entry, like `claims.ts`.

---

## 4. PRs

Six PRs. 1.1 goes first; then 1.2, 1.5 and 1.6 can run in parallel; 1.3 follows 1.2; 1.4 follows 1.3.

| PR | Contents | Depends on |
|---|---|---|
| **1.1 Schemas and hashing** | `brief`, the shared types, `outcome` and `observations` schemas, `canonical`, golden vectors, JSON Schema export and its CI drift job | M0 |
| **1.2 Time and acceptance** | `time`, `acceptance`, `heard-date`, the DST/midnight suite, property tests | 1.1 |
| **1.3 Limits** | `limits` (budget, redial, opening hours, working days) | 1.2 |
| **1.4 Task machine** | `task-machine`, `escalation`, `disclosure`; table, exhaustiveness and model-based tests | 1.1, 1.3 |
| **1.5 Knowledge and contacts** | `citation`, `channel`, `profile-derive`, `contact-switch`, `identity-match` | 1.1 (and 1.3 for `contact-switch`'s limit check) |
| **1.6 Text safety and locale** | `secrets` with both corpora, `locale/en-GB`, `render/`, `CODEOWNERS` entry | 1.1 |

Each PR turns on the coverage threshold for its own files in the Vitest config in the same PR, so a threshold never lands before its code.

---

## 5. Gaps found while planning

### Corrections to the implementation plan

- **C1 — Escalation revisions can't be written by a Postgres function.** Plan §3.2 has `create_escalation_revision(action)` as a Postgres function that writes a new revision. But plan §2.2 says Postgres can't run JCS, and the revision hash must be written when the revision is created. Fix: `applySuggestedAction` in `core` builds the revision, a server action writes it with its hash, and Postgres only does the atomic insert. Affects M2/M3; no owner decision needed.
- **C2 — `mayAutoSwitchContact` is missing from plan §2.1.** Added above.

### New gaps

These go into the plan's §5 table as G13 onwards when this plan is accepted.

| # | Issue | Where | Proposed default |
|---|---|---|---|
| **G13** | `emailFallbackToPhoneAfter` defaults to `P2D` (2 calendar days) in spec 02, but spec 07 says **2 working days** | 02 vs 07 | Make the field `{ workingDays: number }`, default 2. Working days exclude weekends and E&W bank holidays (M1-Q3) |
| **G14** | Outcomes `no_availability`, `needs_user` and `no_contact(closed)` have no transition row. The table's `hung_up` isn't an outcome kind | 03 | Rows as in [§3.3](#33-task-machinets); `hung_up` becomes the system `dropped` outcome |
| **G15** | No way out of `awaiting_cancel_confirmation` if the user never confirms | 03 | Lifetime applies from approval; on expiry → `withdrawn` (nothing was done, so it isn't a failure), with an inbox note |
| **G16** | `reject` vs `outside_rule` from `evaluateAcceptance` isn't defined | 06 | [§3.4](#34-acceptancets-i-9) (M1-Q4) |
| **G17** | `Window.recurring.between` is `{start, end}` strings, with no type: dates or instants? Inclusive? | 06 | Inclusive local dates (M1-Q5) |
| **G18** | Practitioner appears twice: `service.practitioner` and `acceptance.practitioner.mustBe` | 02, 06 | `acceptance` decides; `service.practitioner` is what the agent asks for. A refinement rejects a Brief where both are set and disagree |
| **G19** | The opener's noun (patient, customer, client) needs a business type, but neither the Brief nor `businesses` has one | 04, 08 | Add `business.kind` to the Brief and `businesses.kind` (M1-Q7) |
| **G20** | Q39 condition 2 needs the business's own domain, but `businesses` has no website column | 04, 08 | Add `businesses.website` in M2; `isFirstPartySource` takes it as input |
| **G21** | `notesForAgent` goes into the phone prompt. A user who types their date of birth into the notes puts a profile value in the prompt, bypassing `reveal_profile_field` (D3, I-7) | 02, 05 | Also reject notes that contain any of the user's own profile values: `rejectProfileValues(text, values)`, run at draft time by the web server (M1-Q8) |
| **G22** | The prompt carries "the user's first name for the identity step" (spec 01), but the Brief has no such field, so the worker would read it from outside the Brief (I-3) | 01, 02 | Add `forPerson: { firstName }` to the Brief, pinned at draft time (M1-Q7) |
| **G23** | Spec 03's lifetime row fails an unanswered lifetime escalation after 48h; G5 proposes 7 days for every escalation | 03, plan G5 | Both: 48h when the reason is `limit_reached` (the task is already over its limits), 7 days otherwise (M1-Q2) |

---

## 6. Invariants and graders touched

M1 runs no graders (the harness is M5), but these functions are what the M4 guards and M5 graders are built on.

| Invariant | M1 function | Later consumer |
|---|---|---|
| I-1 disclosure | `locale/en-GB` opener, email signature | `disclosure_first_turn` compares against the rendered template; `email/render` appends the signature |
| I-3 Brief boundary | `revisionHash`, approve guards, `applySuggestedAction`, `mayAutoSwitchContact` | `approve_brief()` (M2), worker (M4) |
| I-4 CLI and abandonment | 5-minute redial rule, `end_live_call_gracefully` on withdraw, `+44` check | worker, `graceful_exit` |
| I-5 / D10 observations | typed per-kind schemas, deterministic `deriveBusinessProfile` | observation writer, cache job |
| I-6 no secrets | `rejectSecrets` (and `rejectProfileValues`, if G21 is accepted) | chat agent's draft tool, profile notes |
| I-7 disclosure gate | `mayRevealField`, `validateOutcome` (P5) | `reveal_profile_field`, `end_call`, `identity_before_reveal`, `only_allowed_fields` |
| I-8 limits | `limits.ts`, `callBudget` | runner, watchdog, `limits_respected` |
| I-9 acceptance | `evaluateAcceptance`, `checkHeardDate` | `propose_slot`, `acceptance_respected`, email auto-act |
| I-10 cancel gate | the `awaiting_cancel_confirmation` guard | `confirm_cancel`, `cancel_gate` |
| I-11 citations | `citationHolds`, `isFirstPartySource` | `verifyCitation` (M7) |

---

## 7. Exit criteria

M1 is done when all of these are true on `main`:

- [ ] Vitest coverage thresholds **enforced in CI**: ≥95% branch coverage on `acceptance`, `task-machine`, `limits`, `secrets`, `citation` (the plan's list) and on `contact-switch` (added: it's an I-3 guard). ≥90% on the rest of `core`.
- [ ] The named DST and midnight tests from [§3.4](#34-acceptancets-i-9) exist and pass, including both 2026 transitions.
- [ ] Property tests run at least 1,000 cases each in CI, with a fixed seed printed on failure.
- [ ] Every `(state, event)` pair in the task machine returns a transition or a typed rejection (exhaustiveness test).
- [ ] The model-based task test holds the five properties in [§3.3](#33-task-machinets).
- [ ] `docs/spec/schemas/brief.v1.json` is committed and CI fails if it differs from `toJsonSchema()`.
- [ ] Golden hash vectors are committed and pass, as do the RFC 8785 vectors.
- [ ] Both `secrets` corpora pass: every positive flagged, every false-positive case allowed.
- [ ] The en-GB signature and opener match their fixtures byte for byte.
- [ ] `core` has no internal dependencies and only the allow-listed runtime ones (M0's dependency check).
- [ ] The accepted defaults for G1, G3–G5 and G13–G23 are recorded: the spec files updated where a default changes the spec, and a decision record for any that change an interview decision (none are expected to).

---

## 8. Questions for the owner

Each has a default; silence means the default. The first one is a batch confirmation because M1 is where those defaults turn into code.

| # | Question | Default |
|---|---|---|
| **M1-Q1** | Confirm the plan's defaults for **G1** (no `draft` task state), **G3** (counters persist across revisions), **G4** (in-rule voicemail → redial to confirm) and **G7** (deterministic = scripted callee), and the defaults for the new gaps not asked about below: **G14**, **G15**, **G18**, **G20**? | Confirmed as written in plan §5 and [§5](#new-gaps) above |
| **M1-Q2** | How long does an unanswered escalation stay open? (G5, G23) | 48h if the reason is `limit_reached`, otherwise 7 days, with a reminder at 48h. Expiry → `failed` (`user_unresponsive`) |
| **M1-Q3** | Email fallback: 2 **working** days, excluding England & Wales bank holidays? (G13) | Yes. Scotland and NI holidays differ; using the E&W list for everyone is a known, small inaccuracy for v1 |
| **M1-Q4** | Split `reject` (not a real offer: invalid, in the past, inconsistent date) from `outside_rule` (a real offer the rule excludes; logged for escalation)? (G16) | Yes, as in [§3.4](#34-acceptancets-i-9) |
| **M1-Q5** | Recurring windows' `between` as **inclusive local dates** (`2026-10-31` means up to 23:59 that day)? (G17) | Yes |
| **M1-Q6** | When a call ends without `end_call` (callee hangs up, provider error, watchdog cut), treat it as `no_contact` for redials, but record it as `dropped` so it's visible? | Yes |
| **M1-Q7** | Add three fields to `faff.brief/v1` now, while there's no data: `business.kind` (opener noun, G19), `forPerson.firstName` (G22), and `emailFallbackToPhoneAfter` as working days (G13)? | Yes. All three are on the approval card too, so the user sees what the agent will say |
| **M1-Q8** | Secrets detection: (a) reject secret **keywords only when a value follows** ("my PIN is 4471"), not bare mentions; (b) also reject `notesForAgent` that contain the user's own profile values (G21)? | (a) yes; (b) yes. (b) is new but closes a real D3 bypass |
| **M1-Q9** | When several offers pass, must the agent take the one `pickPreferred` picks, or may it choose among `accept`ed slots? | Code picks. The same argument as I-9: `preference` is the user's decision made in advance. Enforced in M4 by having `propose_slot` return a ranking |
