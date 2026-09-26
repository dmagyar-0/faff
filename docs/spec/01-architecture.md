# 01 — Architecture

## Stack (Q30)

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One language across web, worker, schemas and evals. The Brief's zod schema is shared by every process. |
| Web app | Next.js (App Router) on Vercel | Chat, Brief approval, inbox, reports, settings. |
| Database, auth, storage | A **new** Supabase project (eu-west-2 London, or eu-west-1) | Postgres for Briefs, task state and the observation log. Supabase Auth for Google sign-in (Q36). Storage for audio. The existing `dishton` project is unrelated to Faff and must not be reused. |
| Background execution | A long-running Node **worker** process, not on Vercel | Calls last several minutes, and holds and email waits last hours or days. That is beyond serverless time limits. **[derived D8]** Host left open (Fly, Railway, Render, …); it must be a container that can hold WebSocket and webhook traffic. |
| Queue | Supabase Queues (`pgmq`) **[derived D8]** | Keeps queue state in the same transactional store as task state. No second infrastructure dependency. |
| LLMs | Claude, via the Anthropic SDK | Model IDs come from config, never hard-coded, so they can be upgraded without code changes. |
| Voice (real) | A hosted voice-agent platform behind `CallProvider` (Q33) | Speech-to-text, text-to-speech and turn-taking are the platform's job. Faff supplies the policy and the tools. **[derived D9]** Vendor chosen at implementation time. |
| Email | A transactional email provider with inbound parsing | Outbound from a Faff domain, inbound replies through a webhook ([07](07-channels.md)). |

## Repo layout

pnpm workspace monorepo.

```
apps/
  web/            Next.js: chat UI, Brief review/approval, inbox, reports, profile, settings
  worker/         Task runner: dequeues tasks, drives CallProvider / email, enforces limits
packages/
  core/           Domain logic with no I/O: Brief schema (zod) + JSON Schema export,
                  state machine, acceptance-rule evaluator, channel resolver, limit checks
  db/             Supabase migrations, generated types, repository functions
  agents/         Chat agent (drafts Briefs), phone-agent policy + prompts, email agent,
                  web-lookup extractor
  tools/          The tool server: every tool the executing agent can call (see below)
  telephony/      CallProvider interface
    providers/simulated/   in-process simulated callee (default everywhere)
    providers/hosted/      the real vendor adapter, behind FAFF_REAL_CALLS
  email/          Outbound renderer (fixed signature), inbound parser
  sim/            Simulated callee personas, IVR trees, scenario definitions
evals/            Scenario suite runner + graders; CI gate for real calls
docs/
  spec/           This spec
  decisions/      One decision record per interview question
```

**Dependency rule:** `core` depends on nothing. Everything else may depend on `core`. `agents` must not depend on `db` directly. It reaches data only through `tools`, which is the reason `tools` exists.

## Process boundaries

```
 user ──► web (chat agent) ──drafts──► Brief revision ──user approves (UI)──► tasks row + queue msg
                                                                                   │
                                                                                   ▼
                                       worker ──► CallProvider / email ──► business
                                          │            │
                                          │     tool calls (HTTPS, signed)
                                          │            ▼
                                          └────► tools server ──► db (Brief, profile, observations)
```

- **The chat agent** can read the user's profile field *names* (not values), appointments, availability and business lookups, and it can write **draft** Brief revisions. It has no dispatch tool (I-3).
- **The worker** owns the task state machine ([03](03-task-state-machine.md)). It is the only writer of task state other than user actions.
- **The executing agent** (phone or email) runs either inside the hosted voice platform or in-process in the simulated provider. Either way it sees only its Brief-derived prompt and the tool server.

## The tool server is the enforcement point

**[derived D3]** Invariants that live only in a prompt aren't enforced, so the executing agent works through tools, and the tools enforce the rules. The prompt contains the Brief's *intent*: the verb, the service, the business name, the acceptance rule in words, and the user's first name for the identity step (from the Brief's `forPerson.firstName`, G22). It does **not** contain disclosable profile values.

| Tool | Purpose | Server-side guard |
|---|---|---|
| `confirm_business_identity(heard_name, heard_location?)` | Records the callee's answer to the identity question | Fuzzy-matches against the Brief's business. On a match, sets `identity_confirmed` for this call. On a mismatch, returns `end_call_wrong_number`. |
| `reveal_profile_field(field)` | Gets a value to say aloud | Returns the value only if `field` is in `brief.disclosure.allowedFields` **and** `identity_confirmed` (I-7). Every call is logged. |
| `propose_slot(start, end, practitioner?)` | Checks an offered slot | `evaluateAcceptance()` returns `accept` / `reject(reason)` / `outside_rule` (I-9). |
| `record_offer(slot)` | Logs offers that were outside the rule, for escalation | — |
| `get_existing_appointment()` | Details needed to reschedule or cancel | Only when the Brief's verb is reschedule or cancel. |
| `confirm_cancellation_allowed()` | Gate before saying "please cancel it" | A cancel confirmation must exist and, if the cancel is paired, the replacement must be secured (I-10). |
| `end_call(outcome)` | Structured outcome | Validated against the outcome schema. The worker transitions state. |
| `check_limits()` | Remaining minutes | Called by the watchdog too (I-8). |

Tool calls from a hosted platform arrive as signed webhooks with a per-call token that is bound to `(task_id, call_id)`. A token from one call can't reveal fields for another.

## CallProvider

```ts
interface CallProvider {
  readonly id: "simulated" | string;
  placeCall(req: PlaceCallRequest): Promise<CallHandle>;
  onEvent(handler: (e: CallEvent) => void): Unsubscribe;   // ringing, answered, ivr, hold, human, ended, ...
  hangUp(callId: string, reason: HangUpReason): Promise<void>;
}

interface PlaceCallRequest {
  taskId: string;
  callId: string;
  to: E164;                 // resolved + verified (I-11)
  from: E164;               // must be in verified_caller_ids (I-4)
  locale: Locale;           // "en-GB"
  voiceId: StockVoiceId;    // allow-listed stock voice only (I-2)
  openingTemplate: string;  // fixed disclosure line, rendered by core (I-1)
  systemPrompt: string;     // Brief-derived; contains no disclosable profile values (D3)
  tools: ToolManifest;      // points at the tools server with a per-call token
  maxDurationSec: number;   // from Brief limits (I-8)
  record: boolean;          // false if the user opted out (Q25)
}
```

- `simulated` is the default in every environment, including production, until the eval gate passes ([11](11-simulation-and-evals.md)).
- The real provider is chosen by `FAFF_REAL_CALLS=true` **and** a passing eval run recorded for the deployed commit. Both are required.
- IVR navigation (DTMF, spoken menus) is the provider's job for real calls and the simulator's job in tests. IVR paths the agent learns are written back as observations (I-5).
