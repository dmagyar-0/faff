# Q30 — Stack: TypeScript, Next.js, Supabase, Vercel, plus a separate worker

- **Status:** Accepted
- **Decided:** 2026-09-22 (rounds 5–6)
- **Followed interviewer recommendation:** yes

## Question

What stack does the spec assume?

## Decision

TypeScript throughout. Next.js on Vercel. A new Supabase project (Postgres, Auth, Storage). A separate long-running worker for calls.

## Alternatives considered

- Python backend with a TypeScript web app
- Stack-agnostic

## Why

One language, one schema library shared across processes, and it matches the connectors already available. Calls outlast serverless time limits.

## Consequences

Derived D8: queue on `pgmq`, worker host left open.

## Spec

- [../spec/01-architecture.md](../spec/01-architecture.md)
