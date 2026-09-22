# Q3 — UK-first, locale-generic

- **Status:** Accepted
- **Decided:** 2026-09-20/22 (rounds 1–3)
- **Followed interviewer recommendation:** yes

## Question

Which geography?

## Decision

The UK first, with a schema that is locale-generic. Hungary is a named later market.

## Alternatives considered

- UK-only hard-coding
- Multi-market from launch

## Why

The research white space is UK-specific, but retrofitting a locale is expensive.

## Consequences

Every Brief carries a locale and timezone. Strings are catalogued per locale.

## Spec

- [../spec/12-locale-roadmap.md](../spec/12-locale-roadmap.md)
