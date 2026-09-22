# Q23 — Inbound calls and replies become proposed follow-ups

- **Status:** Accepted
- **Decided:** 2026-09-22 (round 4)
- **Followed interviewer recommendation:** yes

## Question

What happens when receptionists call back and businesses reply?

## Decision

Voicemail is transcribed and email replies are parsed. Each becomes a proposed follow-up the user approves with a tap. Exception: if a reply falls inside an acceptance rule the user already authorised, Faff acts and then reports.

## Alternatives considered

- The agent answers inbound calls live
- Forward calls to the user's mobile

## Why

Ofcom requires a caller ID that can be called back, so this path is forced. A live inbound agent would be a second agent with no Brief in front of it. Forwarding hands the call back to the telephobic user.

## Consequences

Voicemail greeting discloses AI status. Unmatched inbound goes to human review.

## Spec

- [../spec/07-channels.md](../spec/07-channels.md)
