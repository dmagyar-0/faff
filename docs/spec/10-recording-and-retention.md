# 10 — Recording and Retention (Q25)

## Position

- **Recording is lawful.** Under RIPA / IPA 2016, recording one's own call for personal purposes needs no consent from the other party. Once the product stores recordings, though, **UK GDPR** applies to that storage.
- **The data subjects include third parties.** Receptionists consented to nothing and have subject-access and erasure rights. Keeping as little as possible is the default.
- **Audio has a debugging purpose.** Misheard dates and names can't be diagnosed from a transcript alone, so storing only transcripts (Q25c) was rejected.

## Rules

| Artefact | Retention | Notes |
|---|---|---|
| Call audio | **30 days**, then hard-deleted | `calls.audio_delete_after`, run by a daily purge job. Stored in a private Supabase Storage bucket. |
| Transcript | Life of the account | Needed for the report and as proof of the booking |
| Structured outcome | Life of the account | |
| `field_reveals` audit | Life of the account | |
| Voicemail audio (inbound) | 30 days | Same purge |
| Email bodies | Life of the account | |
| Eval / simulated calls | Unlimited | No real people involved |

**User opt-out:** `record_calls = false` means the audio is streamed to speech-to-text but never persisted. The transcript is still kept.

**Operator access:** audio is accessible only to the owning user and to a named operator role for debugging, and every operator access is logged. Nothing is used for model training unless there is a future explicit opt-in (not v1).

## Third-party requests

A receptionist's subject-access or erasure request is served by business and date range: `calls` joined to `businesses`, where their speech appears in transcripts. Transcripts store speaker turns as structured JSON so the other party's turns can be exported or redacted without touching the user's turns.

## Disclosure of recording

v1 does not announce recording on the call. It isn't legally required for one-party personal use, and adding it lengthens an opener that already carries the AI disclosure. **Revisit before real calls go live.** Some users and businesses may expect it, and the EU AI Act context for Irish calls should be checked. Tracked as an open item in the eval-gate checklist ([11](11-simulation-and-evals.md#go-live-checklist)).
