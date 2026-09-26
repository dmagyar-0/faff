# Faff v1: Implementation Design and Build Plan

**Status:** proposal for review · **Date:** 2026-09-22 · **Builds on:** [`../spec/`](../spec/README.md) and [`../decisions/`](../decisions/README.md)

The spec says *what* Faff v1 is and which rules can't be broken. This document says *how we build it*: the runtime topology, how the modules fit together, the order we build in, and the choices the spec leaves open. It also lists the gaps and contradictions found while reading the spec closely. Those need a human decision before the code that depends on them is written.

Nothing here overrides an invariant (I-1 to I-12). Where this doc proposes something new it's labelled **P1, P2, …** (a *proposed* decision). Each one becomes a decision record once it's accepted. It's the same treatment the spec gives its D1–D10.

---

## 1. The shape of the system in one picture

```
                      ┌──────────────────────────── Vercel ─────────────────────────────┐
  user (browser) ───► │ apps/web  (Next.js App Router)                                  │
                      │  • chat UI  ── chat agent (Claude, tools: lookup, draft_brief)  │
                      │  • Brief card + approve (server action → approve_brief() RPC)   │
                      │  • inbox, reports, profile, settings, calendar consent          │
                      └───────────────┬──────────────────────────────────────▲──────────┘
                                      │ supabase-js (user JWT, RLS)          │ realtime
                                      ▼                                      │
                      ┌──────────────────────── Supabase (London) ──────────┴──────────┐
                      │ Postgres: briefs, tasks, task_events, observations, …           │
                      │ pgmq queues: task_wake, proof_jobs, lookup_jobs                 │
                      │ pg_cron: sweeps (timers, audio purge, lifetime expiry)          │
                      │ Auth (Google + magic link) · Storage (private audio bucket)     │
                      └───────────────▲─────────────────────────────────────────────────┘
                                      │ service role (table-scoped grants)
                      ┌───────────────┴──────────── worker container (London) ──────────┐
                      │ apps/worker — one deployable, three roles:                      │
                      │  1. runner      dequeues task_wake, applies the state machine   │
                      │  2. tools HTTP  /tools/*  (the enforcement point, D3)           │
                      │  3. webhooks    /voice/*  /email/inbound  /voicemail            │
                      │  + agent-llm    /llm/*   (custom-LLM endpoint for the voice     │
                      │                           platform, P2)                         │
                      └──────┬───────────────────────────┬──────────────────────────────┘
                             │ CallProvider              │ EmailProvider
                     ┌───────┴────────┐          ┌───────┴────────┐
                     │ simulated (in- │          │ outbound + in- │
                     │ process, dflt) │          │ bound parsing  │
                     │ hosted voice   │          └────────────────┘
                     │ (flag + gate)  │
                     └────────────────┘
```

Three deployables: **web** (Vercel), **worker** (one container), and **Supabase**. That's the whole topology. The spec's `packages/tools` becomes an HTTP module that runs *inside* the worker container, not a fourth service (P1).

### P1 — The tools server runs in the worker container

- **Why:** the tools server needs the service role, low latency (the voice platform calls it mid-sentence), and no cold starts. The worker container already has all three. As a separate service it would be one more thing to deploy and secure for no gain.
- **Kept from the spec:** `packages/tools` is still its own package, and `agents` still can't import `db`. The package boundary enforces the rule. The process boundary doesn't need to.
- **In the simulator** the tools are called in-process through the same handler functions, with the same per-call token check. The HTTP layer is a thin adapter, so the sim still tests the real guards (spec 11).

---

## 2. Module design

The monorepo layout is the spec's ([01](../spec/01-architecture.md#repo-layout)). This section covers what's inside each package and how the packages talk to each other.

### 2.1 `packages/core`: pure domain logic, no I/O

This is the package that decides correctness. It has no network, clock, randomness or database access. The time, IDs and data it needs are passed in as arguments. That keeps every rule unit-testable at millisecond speed.

| Module | Signature (sketch) | Notes |
|---|---|---|
| `brief.ts` | `BriefV1` zod schema, `parseBrief`, `toJsonSchema()` | CI writes `docs/spec/schemas/brief.v1.json` and fails if the committed file differs |
| `canonical.ts` | `canonicalJson(x)`, `revisionHash(brief)` | **RFC 8785 (JCS)** canonicalisation, then SHA-256. The web card, the approval RPC and the worker must all produce the same bytes (P3) |
| `task-machine.ts` | `transition(task, event, ctx) → {next, effects[]} \| Rejection` | Returns **effects** (enqueue, schedule timer, create inbox item, write observation) instead of doing them. The worker runs the effects in the same DB transaction |
| `acceptance.ts` | `evaluateAcceptance(rule, slot, busy[], now)` | Uses Temporal (polyfill) for DST-correct window maths. Property-based tests with fast-check |
| `channel.ts` | `resolveChannel(business, userMemory, observations, now)` | Spec 07 rules 1–4 |
| `profile-derive.ts` | `deriveBusinessProfile(observations)` | Deterministic, weighted by recency |
| `secrets.ts` | `rejectSecrets(text) → ok \| {kind, span}` | Luhn, sort code and account patterns, keyword list |
| `citation.ts` | `normalisePhone`, `normaliseWhitespace`, `citationHolds(value, quote, pageText)` | The pure half of `verifyCitation`. The fetching half lives in `agents/lookup` |
| `limits.ts` | `remaining(limits, usage, now)`, `mayDial(...)`, `nextRedialAt(...)` | Includes the opening-hours and "5 minutes after a human answered" rules |
| `locale/en-GB.ts` | Disclosure opener, voicemail greeting, email signature, business nouns, date speech | Everything in spec 12's catalogue. `claims.ts` in web re-exports the user-facing parts |

### 2.2 `packages/db`

- Supabase migrations are plain SQL under `supabase/migrations`, and types are generated from them.
- Repository functions are grouped by caller: `db/web.*` (runs with the user's JWT, under RLS), `db/worker.*` and `db/tools.*` (service role).
- **Postgres functions own the transitions that must be atomic.** The most important one is `approve_brief(brief_id, revision, hash, rendered_text)`, a `SECURITY DEFINER` function that:
  1. checks `auth.uid()` owns the Brief,
  2. recomputes nothing (Postgres can't run JCS reliably). It compares the posted hash with the `revision_hash` stored on the revision row, which the server wrote when the revision was created,
  3. inserts `brief_approvals` and creates or updates the `tasks` row,
  4. applies the first transition (`queued` or `awaiting_cancel_confirmation`),
  5. calls `pgmq.send('task_wake', …)`.

  All five steps run in one transaction. There's no window where a task exists without its queue message, or the other way round.

### 2.3 `apps/worker`: the runner

**Design: the database holds the state, and the queue only says "wake up".** (P4)

- `tasks` gains `next_wake_at timestamptz null` and `lease_until timestamptz null`.
- A `task_wake` message carries only `{task_id}`. The handler:
  1. takes the task row with `SELECT … FOR UPDATE SKIP LOCKED` and sets a lease,
  2. reloads the task, the approved Brief revision and the usage counters,
  3. works out which event is due (a timer has fired, a call has ended, a reply has arrived),
  4. calls `core.transition`, runs the effects, appends to `task_events` and commits.
- Every timer (redial, email fallback, lifetime expiry, escalation expiry) is also a `next_wake_at` value. A **pg_cron sweep every minute** re-enqueues any task whose `next_wake_at` has passed and which holds no lease. pgmq's delayed send is only an optimisation. The sweep means a lost message or a crashed worker can't strand a task.
- Handlers are **idempotent by construction**. A duplicate wake reloads the task, sees nothing is due and does nothing.

**The live call loop** (per call, inside the runner):

```
placeCall ─► provider events ─► (answered, human) ─► agent turns ⇄ tools
    │                                                      │
    └─ watchdog: every 5s, check_limits(); at limit ─► graceful close line ─► hangUp
                                                           │
                         end_call(outcome) ─► validate ─► transition(call.ended)
```

The watchdog also ends a call when the provider's `maxDurationSec` would be reached. Both mechanisms are there because I-8 is an invariant: the provider limit is a backstop, the watchdog is the primary control.

### 2.4 `packages/tools`: the enforcement point

Each tool is `(ctx: CallContext, input) → result`, where `CallContext` is loaded from the **per-call token**. The token is an HMAC over `(task_id, call_id, exp)`, signed with a worker secret. The tool never trusts IDs in the tool input, only IDs from the token. Tool behaviour is specified in [01](../spec/01-architecture.md#the-tool-server-is-the-enforcement-point). Additions:

- `identity_confirmed` is stored on the `calls` row (`identity_confirmed_at`), not in memory, so a worker restart mid-call can't reset it to true.
- `reveal_profile_field` decrypts the value (see §2.7) and writes a `field_reveals` row **in the same transaction** as the decision. The audit can't miss a reveal.
- `end_call` rejects an outcome whose `disclosedFields` doesn't match the `field_reveals` log, instead of only flagging it. The agent gets an error back and must correct it. This is stricter than spec 03, which only flags a mismatch for review (P5).

### 2.5 `packages/agents`

Four agents. Each is a small, testable module: a prompt, a tool list and a loop.

| Agent | Runs in | LLM shape | Output |
|---|---|---|---|
| **Chat agent** | web (streaming route handler) | Tool-use loop. Tools: `find_business`, `lookup_contact` (async job), `list_appointments`, `get_availability`, `profile_field_names`, `draft_brief_revision` | Draft `brief_revisions` rows. It has no approve or dispatch tool (I-3) |
| **Phone agent** | worker (`/llm` endpoint, or in-process for the sim) | Low-latency streaming tool-use loop, one turn per callee utterance | Speech text plus tool calls. The final `end_call` |
| **Email agent** | worker | Single call with structured output | An email body. The renderer adds the fixed header and signature |
| **Lookup extractor** | worker (`lookup_jobs`) | Web search and fetch, then structured-output extraction of `{value, url, quote}[]` | Candidates, then `verifyCitation`, then observations |
| **Inbound parser** | worker | Structured output: `{offersSlots?, confirms?, asksFor?, declines?}` | A typed parse. `core` decides what happens next |

**LLM configuration.** All agents use the Anthropic TypeScript SDK. Model IDs come from config, per agent (spec 01). The starting default is `claude-opus-5` for every agent, with `output_config.effort` tuned per route: low for the phone agent (latency matters), medium or high for the chat agent and the extractor. Other points:

- Structured outputs (`output_config.format` with a zod-derived schema) for the extractor, the inbound parser and the email agent.
- `strict: true` on every tool definition, so tool inputs always validate against the schema.
- The lookup extractor uses the server-side `web_search` and `web_fetch` tools, so there's no separate search-API key. **The citation check still re-fetches the page itself** (I-11). The model's fetch is never used as evidence.
- Prompt caching on the stable prefix (system prompt plus tools) for the phone agent, because it runs many short turns per call.

Whether the phone agent needs a faster model to meet the latency target (under 700 ms, Q33) is an open question. We measure it on the simulator (§5, Q-C) before changing anything.

### 2.6 `packages/telephony`: one agent, two voices

### P2 — The hosted voice platform only handles speech; Faff's own agent loop does the thinking

This is the most important architectural choice in this doc.

- **The problem:** hosted platforms (Vapi, Retell) normally run *their own* LLM loop with your prompt. If we used that, the phone agent in real calls would be a different program from the one the eval suite tests in the simulator. The gate (Q34) would then certify an agent that never makes a real call.
- **The fix:** pick a vendor that supports a **custom-LLM endpoint** (both named vendors do). The platform does speech-to-text, text-to-speech, turn-taking, barge-in, DTMF and the phone line. For each turn it sends the transcript to `worker:/llm/:callId` and speaks whatever that endpoint streams back. That endpoint runs **the same `agents/phone` loop** the simulator runs.
- **Result:** simulated and real calls differ only in the transport. The graders test the code that talks to real people.
- **Also covers I-1:** the fixed opener is produced by our loop on the first "human detected" turn, not by a vendor "first message" setting that would fire when an IVR answers.
- **Vendor choice (D9) becomes one concrete question:** which vendor's custom-LLM mode gives us (a) human-vs-IVR/voicemail detection events, (b) DTMF sending from our loop, (c) a hard max duration, (d) recording on/off per call, (e) a UK number with verified CLI. Those are hard requirements. Among the vendors that meet them, the choice is made by the vendor bake-off in §4.1, not decided up front.

```ts
// packages/telephony
interface CallProvider { /* as spec 01 */ }

interface AgentTransport {            // what the phone-agent loop sees, in sim and real
  onUtterance(h: (u: CalleeUtterance) => void): void;   // transcribed callee speech + stage
  say(text: AsyncIterable<string>): Promise<void>;      // streamed speech
  sendDtmf(digits: string): Promise<void>;
  stage(): "ringing" | "ivr" | "hold" | "human" | "voicemail" | "ended";
}
```

The simulated provider implements `AgentTransport` directly with text. The hosted adapter implements it on top of the vendor's custom-LLM protocol.

### 2.7 Secrets and personal data at rest

- `profile_fields.value` uses **application-level envelope encryption** (AES-256-GCM, a per-row data key wrapped by a master key held in env/KMS). Supabase's pgsodium column encryption is deprecated, so we don't build on it.
- Only two code paths decrypt: the web server (so users can see their own profile) and `tools.reveal_profile_field`. The chat agent sees field *names* only, not values.
- Google Calendar refresh tokens are stored encrypted the same way (see §2.8).

### 2.8 Calendar

- Sign-in (Supabase Auth, Google) asks only for `openid email profile` (Q36).
- Calendar consent is a **separate OAuth flow run by Faff** (`/api/google/connect`), not Supabase's `provider_token`. Supabase doesn't manage refresh tokens for scopes added later. We store the refresh token ourselves, encrypted, in a `google_connections` table.
- Scopes are `calendar.app.created` and `calendar.freebusy` (D7). Both are **sensitive scopes**, so Google must verify the app. That can take weeks, so start it during M6, not at go-live.

### 2.9 Email

- Pick a provider that does outbound, inbound parsing and per-address routing (`t-<token>@reply.<domain>`). **Postmark** is the default proposal: it has separate message streams for `bookings@` and `notifications@`, inbound webhooks, and good UK deliverability. Resend and SES would also work. P6 is the email provider choice.
- `packages/email/render.ts` owns the envelope: From, Reply-To, subject prefix and the **fixed signature**, taken from the locale catalogue. The agent only ever supplies the body text. A unit test checks that the rendered output always ends with the signature bytes.

---

## 3. Key flows, end to end

### 3.1 Book, happy path (simulated phone)

1. **Chat.** "Book me a check-up at my dentist, weekday mornings in the next two weeks." The chat agent finds the business (per-user tier first). If it needs a contact it starts a `lookup_contact` job and tells the user it's looking. The result arrives by realtime, and the agent calls `draft_brief_revision`. `rejectSecrets` runs on every free-text field.
2. **Card.** The web renders the revision with `core`'s renderer. The **hash comes from the server**, and the card shows everything spec 02 requires.
3. **Approve.** A server action calls `approve_brief()`. The task becomes `queued` and a `task_wake` message is sent.
4. **Dispatch.** The worker takes the task, checks `mayDial`, creates a `calls` row, mints the call token and calls `provider.placeCall`.
5. **Call.** The simulator runs the IVR, hold and then a human. The agent speaks the fixed opener and calls `confirm_business_identity`, then names the user. It asks about availability, calls `propose_slot` for each offer, accepts one, calls `reveal_profile_field('date_of_birth')`, gets the reference number and calls `end_call({kind:'booked',…})`.
6. **Completion.** `call.ended(success)` moves the task to `completed`. The effects are: an `appointments` row, observations (`reached_ok`, `ivr_path`, `hold_minutes`, `accepted_ai`) and three `proof_jobs` (report, calendar, confirmation email), each retried on its own.
7. **Notify.** An inbox `report` item is created, and a notification email goes out with a one-line summary.

### 3.2 Escalation round-trip

`call.ended(outside_rule_offers)` moves the task to `escalated`, with `{offers, suggestedActions}`. The inbox card shows the offers. When the user taps one, the web calls `create_escalation_revision(action)`, a Postgres function that writes a new revision with `created_by='escalation'` and an exact-slot window. The user then gets the normal approval card, pre-filled, and approves it with one tap. `approve_brief()` sees that the task is `escalated` and moves it to `queued` with the new `approved_revision`.

### 3.3 Cancel gate

The approval moves the task to `awaiting_cancel_confirmation`. The inbox shows `confirm_cancel`, with a button label that repeats the date. `confirm_cancel(appointment_id)` checks the ID against the Brief, inserts `cancel_confirmations` and moves the task to `queued` or `waiting_on_pair`. On the call, `confirm_cancellation_allowed()` checks that row again (defence in depth).

---

## 4. Build plan

The approach is a **walking skeleton first, then widen**. The first goal is one booking made end to end, against the simulator, graded by the eval harness, before any second verb, channel or polish. That way the riskiest integrations (Brief → approval → worker → agent → tools → outcome) are proven early, and every later feature ships with graders already in place.

| # | Milestone | What exists at the end | Exit criteria |
|---|---|---|---|
| **M0** | Foundations | pnpm monorepo, TS project refs, lint/format/typecheck, Vitest, GitHub Actions, the Supabase project (London), migrations CI, Vercel project, worker container skeleton with a health endpoint | CI green on an empty app; `supabase db reset` works locally |
| **M1** | `core` domain | All of §2.1 with unit and property tests, plus the Brief JSON Schema export | ≥95% branch coverage on `acceptance`, `task-machine`, `limits`, `secrets`, `citation`; DST and midnight-crossing cases pass |
| **M2** | Data and identity | All tables, RLS, the append-only trigger, `approve_brief()`, Google and magic-link sign-in, onboarding (capability statement, profile, encryption), `user_businesses` entry | RLS tests: user A can't read B's rows; `business_observations` UPDATE/DELETE raise errors |
| **M3** | Chat → Brief → Approve | Chat agent with tools, Brief card, approval, inbox shell. Contact resolution through user memory only (web lookup comes in M7) | A user can chat, get a card, approve it, and see a `queued` task. Approving with a stale hash is rejected |
| **M4** | Worker + sim + phone agent (**skeleton complete**) | Runner (P4), tools module, simulated provider (text, one persona, no IVR), phone-agent loop, watchdog, `end_call` → `completed` → report | One happy-path booking runs end to end in dev from the UI |
| **M5** | Eval harness and gate | `evals/` runner, scenario format, all 9 graders, `eval_runs` table keyed by commit, CI job, the gate check in the worker | Deterministic suite runs on every PR; `FAFF_REAL_CALLS` can't take effect without a stored passing run |
| **M6** | Breadth: verbs and robustness | Reschedule (paired), cancel gate and paired cancel, escalation round-trip, redial policy, IVR trees, hold, identity-mismatch path, the full scenario table from spec 11 | Suite covers every family in spec 11. Invariant graders at 100%, outcome accuracy tracked |
| **M7** | Contacts and knowledge | Web lookup (search → extract → `verifyCitation`), observations written back, `deriveBusinessProfile` cache, channel resolver on the card | A web-found number without a verbatim citation is never dialled (test) |
| **M8** | Email and inbound | Outbound email agent and renderer, chasers, inbound email parse and auto-act, simulated voicemail → inbox, human-review queue, email fallback to phone, all against a **simulated email provider** (no domain yet, §7) | Email scenarios in the suite pass; signature test passes |
| **M9** | Proof and notifications | Calendar consent and events (`.ics` fallback; Google testing mode), confirmation email (simulated until M11), in-app inbox notifications | A booking produces all three proofs; each retries on its own |
| **M10** | Retention and ops | Audio purge, account deletion cascade, operator audit log, third-party SAR export, structured logging and tracing, alerting on stuck tasks | Purge and deletion tests pass; runbook written |
| **M11** | Real-call readiness | Vendor bake-off (§4.1), hosted adapter for the chosen vendor, UK number + CLI verification, inbound voicemail on the real number, live-callee nightly suite, owner test calls (§4.1), go-live checklist | Everything on spec 11's checklist is ticked. The gate passes on the deployed commit. The owner signs off on how the calls feel. First manual friendly call made and reviewed |

**M1 to M5 is the critical path.** M6, M7 and M8 can run in parallel once M5 lands, because each adds scenarios to the same harness. M9 has no dependency on M6 to M8 beyond M4. Google verification (§2.8) and email domain setup (SPF, DKIM, DMARC) take calendar time. Both wait for a domain (§7), so they happen at the start of M11, and M11 should allow a few weeks for them.

Each milestone is one or more PRs (Q9). Each PR carries the eval result for its commit from M5 onwards.

**Planning each milestone.** Each milestone gets its own plan before any code is written, in `docs/design/milestones/Mn-<name>.md`, and is discussed in a separate session. A milestone plan covers: scope in and out, the PRs it splits into, the tables/modules/tests it adds, which invariants and graders it touches, its exit criteria in checkable form, and the questions it needs answered. Start with M0 and M1.

### 4.1 Choosing the voice vendor and judging how calls feel

Nobody has picked a voice vendor, and there's no reason to guess. The P2 design makes the vendor a transport behind `AgentTransport`, so vendors can be compared on the same agent code.

**Vendor bake-off (M11, before building the full adapter):**

1. **Filter** on the hard requirements in §2.6 (custom-LLM mode, human/IVR/voicemail detection, DTMF, max duration, per-call recording switch, UK number with verified CLI). Check the documentation, then confirm with a short throwaway prototype.
2. **Build a thin adapter** for each vendor that passes (expected: two or three). Each adapter only needs to be good enough to hold a call.
3. **Run the same scripted calls** through each vendor. The callee is the owner or the simulator's persona read aloud over a real phone line. No real business is called.
4. **Measure**: the time from the callee finishing speaking to the agent starting to speak (p50 and p95), talking over each other and interruptions, how accurately the speech-to-text transcribes dates, names and reference numbers, voice quality, cost per minute, and how easy the vendor is to integrate.
5. **Decide** with a short decision record (superseding D9) and build the production adapter only for the winner.

**Owner test calls (M11, before go-live):** the owner plays the receptionist on real calls placed through the chosen vendor. Some calls follow a script (the spec 11 scenario families: happy path, out-of-rule offers, hostile, identity mismatch, misheard dates). Some are unscripted. After each call the owner scores it on a short form: did it sound natural, was the AI disclosure clear, would a receptionist hang up, how long were the pauses, and any moments that felt wrong. Every call's transcript and scores are stored alongside the eval runs. They aren't pass/fail graders. They are the judgement the automated suite can't make ("does this feel like a call a receptionist would put up with?"). They also answer Q-C (the trade between speed and model capability) with real numbers. Go-live needs the owner's sign-off on these calls **in addition to** the automated gate (Q34).

This is also a safe way to test real telephony early: every call goes to the owner's own phone, so no third party is involved.

---

## 5. Gaps and contradictions in the spec

Found while mapping the spec to code. Each needs a decision. The **proposed default** is what we'd build if nobody objects.

| # | Issue | Where | Proposed default |
|---|---|---|---|
| **G1** | `draft` is listed as a *task* state, but a task is described as "one approved Brief being carried out". When is the `tasks` row created? | 03 | A draft is a property of the **Brief**, not of a task. The `tasks` row is created by `approve_brief()`, and the state machine starts at `queued` or `awaiting_cancel_confirmation` |
| **G2** | After a **wrong number**, resolution re-runs and the task goes back to `waiting` → `queued` and dials the *new* number. But the number is part of the approved Brief (`business.contact`). Dialling a number the user never saw arguably breaks I-3 | 03, 08 | **Decided (owner, 2026-09-24): [Q39](../decisions/Q39-after-a-wrong-number-switch-automatically-only-when-code-can-vouch-for-the-new-number.md).** Faff switches automatically when a deterministic check vouches for the new number: it came from your saved details or the business's own site or NHS listing, it's for the same business, it's the first switch on the task, and limits remain. The Brief pre-authorises this. Otherwise Faff asks you with one tap |
| **G3** | Do the limit counters (`attempts_used`, `call_seconds_used`) reset when an escalation revision is approved? `raise_limits` suggests they don't | 02, 06 | Counters **persist across revisions** of a task. Limits on the new revision are totals. `raise_limits` exists to widen them |
| **G4** | The state table sends `voicemail.received` to `escalated`, but 07 says an in-rule callback voicemail is auto-acted (redial to confirm) | 03 vs 07 | Add `waiting --voicemail.received(in_rule)--> queued` (redial to confirm, counts to limits), mirroring the email auto-act row |
| **G5** | Only `timer.lifetime_expired` has a timeout (48h → `failed`). An `escalated` task the user never answers stays open for ever | 03 | Every `escalated` state gets an `escalation_expires_at` (default 7 days → `failed`, reason `user_unresponsive`) and a reminder notification at 48h |
| **G6** | "`simulated` is the default in production." Then what does a production user get before the gate passes, a fake booking? | 01, 11 | **Decided (owner, 2026-09-23):** before the gate, only the owner uses Faff. Every simulated report still carries a banner: "Simulated call — nothing was booked". No sign-up for anyone else yet |
| **G7** | "Deterministic mode … recorded callee responses." Recorded callee responses stop matching as soon as the agent's wording changes, and replaying the *agent* would test nothing | 11 | "Deterministic" means **a scripted, rule-based callee** (a state machine per persona, no LLM) with a fixed seed. The agent is always the live model. The LLM callee is for the nightly and pre-flip runs |
| **G8** | Missing tables and columns: `eval_runs`, `user_settings` (`record_calls`, `nhs_number_opt_in_at`), `google_connections`, `offers` (from `record_offer`), `operator_access_log`, `inbound_review_queue`, `tasks.next_wake_at` / `lease_until` / `escalation_expires_at`, `calls.token_jti` | 04 | Add them in M2 migrations. The schema changes don't alter any invariant |
| **G9** | Identity matching is "fuzzy" but has to be deterministic, and runs on speech-recognised text ("Smile Dental" heard as "smile dent all") | 08 | `confirm_business_identity` uses deterministic token-set similarity plus a per-business alias list (from observations and the user's own naming), with the threshold set from sim noise scenarios. One clarification is allowed, then end the call (spec already) |
| **G10** | The paired-cancel second confirmation is "collected up front", but the Boots booking might land on a different date from the one the user pictured. Is the cancel still wanted? | 06 | Keep the spec: the condition is "only if the booking succeeds". The booking's own acceptance rule already bounds what "succeeds" means |
| **G11** | `notesForAgent` is free text from the chat agent. Prompt injection from the *user's* chat into the phone prompt is covered by the scenario suite, but the chat agent itself reads web pages (lookup) | 02, 08 | The lookup extractor runs as a **separate agent** with no Brief-writing tools. Its only output is typed candidates, so a malicious page can't write into a Brief |
| **G12** | EU AI Act and Irish businesses: the spec mentions extraterritorial reach, but v1 is UK numbers only | 00, 12 | `placeCall` rejects non-`+44` destinations in v1 (a one-line guard). It widens with the locale roadmap |

G13 onwards were found while planning M1 ([M1 §5](milestones/M1-core-domain.md#5-gaps-found-while-planning)). **Decided (owner, 2026-09-24):** M1 was accepted with every default, which also confirms G1, G3, G4, G5 (with G23's split) and G7 above (M1-Q1). Each default is recorded in the spec by the M1 PR that implements it.

| # | Issue | Where | Decided default |
|---|---|---|---|
| **G13** | `emailFallbackToPhoneAfter` defaults to `P2D` in 02, but 07 says 2 **working** days | 02 vs 07 | `{ workingDays: number }`, default 2; weekends and England & Wales bank holidays excluded (M1-Q3, M1-Q7) |
| **G14** | `no_availability`, `needs_user` and `no_contact(closed)` have no transition row; the table's `hung_up` isn't an outcome kind | 03 | Rows per M1 §3.3; `hung_up` becomes the system `dropped` outcome (M1-Q6) |
| **G15** | No way out of `awaiting_cancel_confirmation` if the user never confirms | 03 | Lifetime applies from approval; on expiry → `withdrawn`, with an inbox note |
| **G16** | `reject` vs `outside_rule` from `evaluateAcceptance` isn't defined | 06 | `reject` = not a real offer (invalid, in the past, inconsistent date); `outside_rule` = a real offer the rule excludes (M1-Q4) |
| **G17** | `Window.recurring.between` has no type | 06 | Inclusive local dates (M1-Q5) |
| **G18** | Practitioner appears in `service` and in `acceptance` | 02, 06 | `acceptance` decides; `service.practitioner` is who the agent asks for; a Brief where they disagree is rejected |
| **G19** | The opener's noun needs a business type | 04, 08 | `business.kind` on the Brief and `businesses.kind` (M1-Q7) |
| **G20** | Q39 condition 2 needs the business's own domain | 04, 08 | `businesses.website` in M2; `isFirstPartySource` takes it as input |
| **G21** | Profile values typed into `notesForAgent` bypass `reveal_profile_field` | 02, 05 | `rejectProfileValues(text, values)` at draft time, alongside `rejectSecrets` (M1-Q8) |
| **G22** | The prompt needs the user's first name, but the Brief has no such field | 01, 02 | `forPerson: { firstName }` on the Brief (M1-Q7) |
| **G23** | Spec 03 fails an unanswered lifetime escalation after 48h; G5 proposes 7 days | 03 | 48h when the reason is `limit_reached`, 7 days otherwise, reminder at 48h; expiry → `failed` (`user_unresponsive`) (M1-Q2) |

---

## 6. Proposed decisions (summary)

| ID | Proposal | Section |
|---|---|---|
| P1 | The tools server runs inside the worker container; `packages/tools` stays a separate package | §1 |
| P2 | The hosted voice platform runs in custom-LLM mode, so the phone agent in real calls is the same code the evals test | §2.6 |
| P3 | RFC 8785 JCS + SHA-256 for `revisionHash`; the hash is computed server-side when the revision is written | §2.1 |
| P4 | DB-authoritative task state with `next_wake_at`; pgmq only wakes tasks up; a per-minute sweep; idempotent handlers | §2.3 |
| P5 | `end_call` rejects outcomes whose `disclosedFields` don't match the reveal log | §2.4 |
| P6 | Email provider: Postmark, unless the spike shows a reason to use something else. Deferred until a domain exists (see §7) | §2.9 |
| P7 | Worker host: Fly.io, London region (`lhr`), because it supports long-lived WebSockets and runs close to Supabase London. D8 left this open | §1 |
| P8 | Application-level envelope encryption for profile values and OAuth tokens | §2.7 |

---

## 7. Questions for the product owner

### Answered (2026-09-23)

- **Q-A (who uses v1 before real calls).** Only the owner. So M9 and M10 need to work, not be polished, before M11: there's no public sign-up, marketing site or waitlist in v1.
- **Q-B (voice vendor).** No preference. It's decided by the vendor bake-off in §4.1.
- **Q-C (speed against model capability).** Decided with evidence: the simulator gives latency numbers from M5 onwards, and the owner test calls in §4.1 judge how the calls feel. The owner will be the receptionist on real test calls before go-live.
- **Q-D (domain).** No domain yet. The owner wants to see how the product feels before committing to a name. Consequences:
  - Until a domain exists, all business-facing email is **simulated**: the email agent, renderer and inbound parser run against an in-process fake email provider (the same approach as `CallProvider`), and the email scenarios in the eval suite use it. Nothing is sent to real addresses.
  - Notification emails to the owner can use Supabase Auth's built-in sender, or be skipped: the in-app inbox is the source of truth (Q32).
  - The domain, email provider choice (P6), SPF/DKIM/DMARC and deliverability warm-up move to M11. Allow a few weeks there for warm-up.
  - Google OAuth verification also needs a domain (for the privacy policy and consent screen). Until then the app runs in Google's **testing mode**, which allows up to 100 named test users. That is enough for owner-only use.

- **Q-E (G2).** Switch automatically when code can vouch for the new number, otherwise ask. Recorded as Q39 (2026-09-24).

### Still open

- The other gaps in §5 (G1, G3–G5, G7–G12) use the proposed default unless the owner objects. They can be confirmed as each milestone plan is discussed.
