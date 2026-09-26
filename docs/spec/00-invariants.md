# 00 — Invariants

These are the rules that no refactor, feature, prompt change or deadline may break. Each rule states **what** it requires, **why** it exists and **where** it is enforced. An invariant enforced only by a prompt is not enforced. Every rule below has a code-level enforcement point and a test in the eval suite ([11](11-simulation-and-evals.md)).

To change an invariant, first add a new decision record in `docs/decisions/` that supersedes the original. Editing this file alone is not a valid change.

---

### I-1 · The agent always discloses that it is an agent.
On every call, and in every email. It is not a setting.

- **Why:** EU AI Act Art. 50 (in force 2 Aug 2026, and it applies extraterritorially the moment Faff calls an Irish business), the ICO transparency principle, and trust. (Q4)
- **Enforced:** the first utterance to a human is a **fixed per-locale template**, not generated text ([08](08-business-resolution.md#callee-identity-check)). Every email carries the fixed signature block ([07](07-channels.md#outbound-email)); the email renderer appends it and the agent cannot omit it.
- **Tested:** eval grader `disclosure_first_turn` (100% pass required).

### I-2 · The agent never impersonates the user.
It never claims to be the user. It never uses a cloned or synthetic copy of the user's voice.

- **Why:** an agent that speaks in a real person's voice to pass a security check is a fraud tool, whatever the consent flow. This was raised in the interview and declined. (Q4)
- **Enforced:** the `CallProvider` voice configuration takes a voice ID only from a server-side allow-list of stock voices. There is no API for uploading a voice. The phone prompt refers to the user in the third person.
- **Tested:** grader `no_impersonation`: flags any agent turn that asserts "I am <user name>" or equivalent.

### I-3 · Nothing reaches the executing agent except through an approved Brief.
The Brief is the safety boundary, the audit record, the liability answer and the unit of async UX.

- **Why:** (Q6). A chat agent with a live phone line is unbounded. A Brief is bounded and can be audited.
- **Enforced:** the worker loads its instructions *only* from an approved, immutable `brief_revisions` row. Dispatch requires `approved_revision_hash` to match that row ([02](02-task-brief.md#approval)). The chat agent has no dispatch tool.

### I-4 · Outbound calls present a valid, returnable UK CLI and never abandon calls.
- **Why:** the Ofcom persistent-misuse regime, with penalties up to £2m. It also forces the inbound path to exist (Q23).
- **Enforced:** `CallProvider.placeCall` rejects any caller ID not in the verified-numbers table. The agent never hangs up on a live human without speaking (the minimum is the disclosure line plus a close). Redials follow backoff rules ([03](03-task-state-machine.md#redial-policy)).

### I-5 · The agent may append observations, never assert facts.
The general knowledge tier is append-only and timestamped, and each row records its source. Derived summaries are disposable caches. (Q19)

- **Why:** LLM-maintained memory rots because each write overwrites the previous one with nobody noticing. Making staleness visible is the only workable defence.
- **Enforced:** the `business_observations` table has no UPDATE/DELETE grants for application roles, and a trigger rejects both. The cache table is written only by a deterministic derivation job, and is never read back into the log.

### I-6 · Faff does not store authentication secrets or payment details.
- **Why:** if Faff held the answers to security questions, "we never impersonate" would be a policy, not a structural fact. (Q21)
- **Enforced:** profile fields are a closed enum ([05](05-onboarding-and-profile.md)). No enum value exists for memorable words, mother's maiden name, passwords, PINs, card or bank details. Free-text fields (Brief notes, chat) are scanned on write, and anything matching a secret or payment pattern is rejected.

### I-7 · Profile fields are disclosed only when the Brief allows it and the callee's identity has been confirmed.
- **Why:** a contact detail found by web search can be wrong or out of date (Q28/Q31). Reading a date of birth to the wrong business is a data leak. (Q21, Q35)
- **Enforced:** the agent gets values only through the `reveal_profile_field` tool. The server returns the value only if the field is on the Brief's `disclosure.allowedFields` list and `identity_confirmed = true` for the current call ([01](01-architecture.md#the-tool-server-is-the-enforcement-point)).

### I-8 · Every task has hard limits on attempts, minutes and lifetime.
When a limit is hit, the task stops and escalates. It never keeps going. (Q27)

- **Why:** a task that redials, holds, is transferred and waits for a callback can run without bound. That is a reliability failure first and a cost failure later.
- **Enforced:** the worker checks `limits` before every dial and every hold extension, and a watchdog ends live calls when the minute limit is reached.

### I-9 · Accepting a slot is a deterministic decision, not an LLM judgement.
- **Why:** the acceptance rule is the user's decision made in advance (Q24). The LLM's job is to *propose* a slot; code checks it against the rule.
- **Enforced:** `propose_slot` tool → `evaluateAcceptance(rule, slot, calendar)` in `packages/core`. The agent may say yes to the callee only after that tool returns `accept`.

### I-10 · Cancellation needs a second, specific confirmation.
The confirmation names the exact appointment and is given after the Brief is approved and before any contact. (Q20)

- **Enforced:** state machine guard: `verb = cancel` cannot leave `awaiting_cancel_confirmation` without a `cancel_confirmations` row that references the `appointment_id`.

### I-11 · Contact details come with evidence.
Faff never dials a number or emails an address obtained from the web unless the exact string appears in a source page that was re-fetched to check it. (Q31)

- **Enforced:** `verifyCitation()` is deterministic code (fetch the page, normalise, substring match), not an LLM call. Failing candidates are discarded.

### I-12 · Honest capability claims.
Faff states what it cannot do. It cannot pass identity checks. It will sometimes be refused or hung up on. It cannot guarantee a booking.

- **Why:** DoNotPay's $193k FTC settlement (Jan 2025) was for over-claiming.
- **Enforced:** onboarding shows the capability statement ([05](05-onboarding-and-profile.md)). Marketing copy and UI strings live in `apps/web/content/claims.ts`, and a review is required to change them. While the owner is the only person, that review is the independent PR review described in [Q40](../decisions/Q40-no-required-approvals-while-the-owner-is-the-only-person.md), not a GitHub approval. That is a process, not a code-level gate: the one exception to this file's rule, accepted by the owner until a second person joins.
