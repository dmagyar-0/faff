# Q25 — Audio kept 30 days; transcript and outcome kept

- **Status:** Accepted
- **Decided:** 2026-09-22 (round 4)
- **Followed interviewer recommendation:** yes

## Question

How long are recordings and transcripts kept?

## Decision

Record in order to transcribe. Delete audio after about 30 days. Keep the transcript and structured outcome. The user can opt out of recording.

## Alternatives considered

- Keep everything indefinitely
- Transcript only

## Why

Recording is lawful (one-party, personal use), but storage means holding the voices of third parties who have subject-access rights. Audio is needed to debug misheard dates, so it can't be dropped entirely.

## Consequences

Recording disclosure on calls is flagged to revisit before go-live.

## Spec

- [../spec/10-recording-and-retention.md](../spec/10-recording-and-retention.md)
