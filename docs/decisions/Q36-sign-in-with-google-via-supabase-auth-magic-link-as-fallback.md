# Q36 — Sign in with Google via Supabase Auth; magic link as fallback

- **Status:** Accepted
- **Decided:** 2026-09-22 (rounds 5–6)
- **Followed interviewer recommendation:** yes

## Question

How do users sign in?

## Decision

Google sign-in via Supabase Auth, with calendar access requested as a separate, optional step. A magic-link email login is the fallback.

## Alternatives considered

- Magic link only
- Email and password

## Why

Calendar needs Google anyway, but bundling the calendar scope into sign-in would make the first step the heaviest ask.

## Consequences

—

## Spec

- [../spec/05-onboarding-and-profile.md](../spec/05-onboarding-and-profile.md)
