# Decision Records

One record per question settled in the Faff design interview (a Matt Pocock `grill-me` style design-tree interview, 20–22 Sep 2026). Each record keeps the **reasoning**, so a later session doesn't unpick a decision that looks like friction.

**To change a decision:** add a new record that supersedes it (for example `Q21b-...md`, with `Status: Supersedes Q21`), and update the spec in the same PR. Never edit an accepted record's Decision section in place.

Decisions the interview didn't cover, but which follow from these records, are listed as **D1–D10** in [../spec/README.md](../spec/README.md#decisions-derived-while-writing-need-review) and need review.

| # | Decision | Recommendation |
|---|---|---|
| [Q1](Q01-session-deliverable-is-a-spec-not-code.md) | Session deliverable is a spec, not code | ✓ |
| [Q2](Q02-v1-wedge-is-appointment-booking-and-changing.md) | v1 wedge is appointment booking and changing | ✓ |
| [Q3](Q03-uk-first-locale-generic.md) | UK-first, locale-generic | ✓ |
| [Q4](Q04-always-an-agent-never-the-person.md) | Always an agent, never the person | ✓ |
| [Q5](Q05-no-real-calls-in-v1-simulated-callee-first.md) | No real calls in v1; simulated callee first | ✓ |
| [Q6](Q06-chat-agent-and-phone-agent-connect-only-through-a-task-brief.md) | Chat agent and phone agent connect only through a Task Brief | ✓ |
| [Q7](Q07-escalate-at-the-brief-boundary-run-to-completion-to-start.md) | Escalate at the Brief boundary; run to completion to start | ✓ |
| [Q8](Q08-the-spec-is-written-for-agents.md) | The spec is written for agents | ✓ |
| [Q9](Q09-delivery-is-always-a-pr.md) | Delivery is always a PR | ✓ |
| [Q10](Q10-book-reschedule-and-cancel-are-all-in-v1.md) | Book, reschedule and cancel are all in v1 | **diverged** |
| [Q11](Q11-gp-8am-scramble-deferred.md) | GP 8am scramble deferred | ✓ |
| [Q12](Q12-availability-comes-from-the-calendar-plus-stated-windows.md) | Availability comes from the calendar plus stated windows | ✓ |
| [Q13](Q13-faff-resolves-phone-numbers-and-remembers-in-two-tiers.md) | Faff resolves phone numbers and remembers, in two tiers | ✓ |
| [Q14](Q14-proof-of-booking-is-a-report-a-calendar-event-and-a-confirma.md) | Proof of booking is a report, a calendar event and a confirmation email | ✓ |
| [Q15](Q15-faff-has-its-own-chat-ui-in-v1.md) | Faff has its own chat UI in v1 | ✓ |
| [Q16](Q16-email-is-a-parallel-and-supporting-channel.md) | Email is a parallel and supporting channel | ✓ |
| [Q17](Q17-email-comes-from-a-faff-address-with-a-fixed-signature.md) | Email comes from a Faff address with a fixed signature | ✓ |
| [Q18](Q18-nothing-for-hungary-now.md) | Nothing for Hungary now | ✓ |
| [Q19](Q19-the-general-knowledge-tier-is-an-append-only-observation-log.md) | The general knowledge tier is an append-only observation log | ✓ |
| [Q20](Q20-cancellation-needs-a-second-confirmation-reschedules-are-pai.md) | Cancellation needs a second confirmation; reschedules are paired | ✓ |
| [Q21](Q21-structured-profile-with-per-field-disclosure-and-hard-exclus.md) | Structured profile with per-field disclosure and hard exclusions | ✓ |
| [Q22](Q22-calendar-write-access-limited-to-events-faff-created.md) | Calendar write access limited to events Faff created | ✓ |
| [Q23](Q23-inbound-calls-and-replies-become-proposed-follow-ups.md) | Inbound calls and replies become proposed follow-ups | ✓ |
| [Q24](Q24-the-brief-carries-a-pre-authorised-acceptance-rule.md) | The Brief carries a pre-authorised acceptance rule | ✓ |
| [Q25](Q25-audio-kept-30-days-transcript-and-outcome-kept.md) | Audio kept 30 days; transcript and outcome kept | ✓ |
| [Q26](Q26-money-is-out-of-scope.md) | Money is out of scope | **diverged** |
| [Q27](Q27-per-task-limits-on-attempts-minutes-and-lifetime.md) | Per-task limits on attempts, minutes and lifetime | ✓ |
| [Q28](Q28-contact-lookup-by-web-search-plus-llm-extraction.md) | Contact lookup by web search plus LLM extraction | **diverged** |
| [Q29](Q29-a-rule-picks-the-channel-and-the-brief-shows-it.md) | A rule picks the channel and the Brief shows it | ✓ |
| [Q30](Q30-stack-typescript-next-js-supabase-vercel-plus-a-separate-wor.md) | Stack: TypeScript, Next.js, Supabase, Vercel, plus a separate worker | ✓ |
| [Q31](Q31-web-found-contacts-need-a-verbatim-citation-with-no-user-con.md) | Web-found contacts need a verbatim citation, with no user confirmation | **diverged** |
| [Q32](Q32-notifications-an-in-app-inbox-plus-email.md) | Notifications: an in-app inbox plus email | ✓ |
| [Q33](Q33-real-calls-use-a-hosted-voice-agent-platform.md) | Real calls use a hosted voice-agent platform | ✓ |
| [Q34](Q34-eval-gate-100-on-invariants-and-at-least-90-outcome-accuracy.md) | Eval gate: 100% on invariants and at least 90% outcome accuracy | ✓ |
| [Q35](Q35-confirm-the-callee-s-identity-before-disclosing-profile-fiel.md) | Confirm the callee's identity before disclosing profile fields | ✓ |
| [Q36](Q36-sign-in-with-google-via-supabase-auth-magic-link-as-fallback.md) | Sign in with Google via Supabase Auth; magic link as fallback | ✓ |
| [Q37](Q37-report-outcome-first-then-the-full-transcript.md) | Report: outcome first, then the full transcript | ✓ |
| [Q38](Q38-spec-shape-multi-file-spec-plus-a-decision-record-per-questi.md) | Spec shape: multi-file spec plus a decision record per question | ✓ |
| [Q39](Q39-after-a-wrong-number-switch-automatically-only-when-code-can-vouch-for-the-new-number.md) | After a wrong number, switch automatically only when code can vouch for the new number | **diverged** |
| [Q40](Q40-no-required-approvals-while-the-owner-is-the-only-person.md) | No required approvals while the owner is the only person | not asked |
