# M0 — Foundations

**Status:** plan for review · **Date:** 2026-09-24 · **Parent:** [implementation plan §4](../implementation-plan.md#4-build-plan)

M0 builds the empty house: a monorepo that lints, typechecks, tests and builds in CI; a local Supabase that resets from migrations; a Next.js app on Vercel; and a worker container that answers a health check. No product code. The point is that from M1 onwards every PR lands on rails that already enforce the spec's structural rules (the package dependency rule, "`core` has no I/O"), so those rules are never retrofitted.

**Exit criteria (from the plan):** CI green on an empty app; `supabase db reset` works locally. The checkable version is in [§6](#6-exit-criteria).

---

## 1. Scope

### In

- pnpm workspace with every package and app from the spec's [repo layout](../../spec/01-architecture.md#repo-layout), as empty stubs, so the dependency rules exist from day one.
- TypeScript project references, ESLint, Prettier, Vitest, one trivial test per package.
- **Machine-checked dependency rules** ([§3](#3-dependency-rules-enforced-in-m0)) and the **`core` purity lint** ([§4](#4-the-core-purity-lint)).
- GitHub Actions: install, lint, format, typecheck, test, build web, build worker image, database checks, secret scan.
- Supabase CLI setup, a baseline migration (extensions only), pgTAP harness, generated-types drift check.
- `apps/web`: a Next.js App Router placeholder, deployed to Vercel with preview deployments.
- `apps/worker`: a Fastify server with `/healthz` and `/readyz`, a Dockerfile, the image built in CI.
- A repo `CLAUDE.md` with the commands and the rules an agent must not break (Q8: the spec is written for agents; the repo should be too).

### Out (and where it lands)

| Not in M0 | Lands in |
|---|---|
| Any table, RLS policy, trigger or Postgres function | M2 |
| Auth (Google, magic link) | M2 |
| `pgmq` queues and `pg_cron` jobs (the *extensions* are enabled in M0, nothing is created on them) | M4 |
| Anthropic SDK, any LLM call | M3 |
| Coverage thresholds (the reporter is wired; the per-file thresholds come with the code they cover) | M1 |
| Structured logging beyond Fastify's built-in pino, tracing, alerting | M10 |
| Brief JSON Schema export and its drift check | M1 |

---

## 2. Toolchain decisions

These are engineering defaults, not owner decisions. They're stated so review can object to one before it's baked in.

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node 24 LTS, pinned in `.nvmrc` and `engines` | Current LTS; same version in CI, Docker and Vercel |
| Package manager | pnpm 10, pinned via `packageManager` | The spec says pnpm. Strict `node_modules` means an undeclared dependency fails to resolve, which backs up the dependency rules |
| Modules | ESM everywhere (`"type": "module"`) | One module system across web, worker and tests |
| TypeScript | Strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Project references with `tsc -b` for **typechecking only** (`emitDeclarationOnly`) | `exactOptionalPropertyTypes` matters for the Brief: "absent" and "`undefined`" must not be the same thing when hashing (P3) |
| How packages are consumed | Internal packages export TypeScript source. Next.js compiles them via `transpilePackages`; the worker is bundled with esbuild; Vitest runs TS directly | No per-package build step, no stale `dist/`. The only artefacts are the web build and the worker bundle |
| Lint | ESLint (flat config) + typescript-eslint, `next` rules in `apps/web` | Needed for the purity rules in §4, which Biome can't express yet |
| Format | Prettier, checked in CI | Conventional; zero config debate |
| Tests | Vitest with a root `projects` config, v8 coverage | Fast, native TS, one runner for every package |
| Task runner | Plain `pnpm -r` scripts. No Turborepo | Not worth it for ten small packages. Revisit if CI passes ~5 minutes |
| Worker HTTP | Fastify | Raw-body access for HMAC-signed webhooks (P1, spec 01), a mature WebSocket plugin for the voice platform later (P2), pino logging built in |
| Secrets in the repo | `.env.example` per app; real values only in Vercel / Fly / GitHub secrets; gitleaks in CI | The repo is the delivery mechanism (Q9); it must never carry a key |

---

## 3. Dependency rules, enforced in M0

The spec's rule is "`core` depends on nothing; `agents` must not depend on `db`" ([01](../../spec/01-architecture.md#repo-layout)). M0 writes the full matrix down as a `dependency-cruiser` config that runs in CI, so loosening it takes a visible PR.

| Package | May import (internal) | Notes |
|---|---|---|
| `core` | — | External runtime deps are allow-listed too (see [M1 §2](M1-core-domain.md#2-cross-cutting-choices)) |
| `db` | `core` | |
| `tools` | `core`, `db` | The enforcement point (D3) |
| `agents` | `core`, `tools` | **Never `db`.** The chat agent's tools are interfaces here; `apps/web` injects the implementations |
| `telephony` | `core`, `sim` | The simulated provider reads personas and IVR trees from `sim` |
| `email` | `core` | |
| `sim` | `core` | Personas and scenarios are data |
| `evals` | anything | |
| `apps/web` | `core`, `db`, `agents` | |
| `apps/worker` | everything except `apps/web` | |

Two layers of enforcement: pnpm refuses to resolve a package that isn't in `package.json`, and dependency-cruiser fails CI on a forbidden edge even if someone adds the `package.json` entry.

---

## 4. The `core` purity lint

The implementation plan says `core` has "no network, clock, randomness or database access". M0 makes that a lint error in `packages/core/**` (tests excluded), so M1 can't drift:

- **Banned imports:** `node:*`, `fs`, `net`, `http(s)`, `child_process`, `@supabase/*`, `@anthropic-ai/*`, and every internal `@faff/*` package.
- **Banned globals and members:** `fetch`, `process`, `Date.now`, `new Date()` with no arguments, `Math.random`, `crypto.randomUUID`, `crypto.getRandomValues`, `Temporal.Now`, `setTimeout`/`setInterval`, `console`.
- **Why a lint and not just review:** the property tests in M1 only mean something if the functions are deterministic. One hidden `Date.now()` in `acceptance.ts` makes a DST test pass today and fail at 01:30 on 25 October.

---

## 5. PRs

Four PRs, in order. 0.2 to 0.4 only depend on 0.1 and can be reviewed in parallel.

### PR 0.1 — Workspace, toolchain and CI

- `pnpm-workspace.yaml`, root `package.json` scripts (`lint`, `format:check`, `typecheck`, `test`, `build`), `tsconfig.base.json` and one `tsconfig.json` per package with references.
- Stub packages: `packages/{core,db,agents,tools,telephony,email,sim}`, `evals`, `apps/{web,worker}`. Each has `src/index.ts`, one test, and its `@faff/<name>` package name.
- ESLint, Prettier, Vitest projects config, dependency-cruiser config (§3), `core` purity rules (§4).
- `.github/workflows/ci.yml`: one job per concern (install is cached): `lint`, `format`, `typecheck`, `test`, `deps` (dependency-cruiser), `secrets` (gitleaks).
- `CLAUDE.md`: commands, the dependency matrix, "read `docs/spec/00-invariants.md` first", "never edit an accepted decision record".
- **Self-test of the rails:** a CI step runs the linters against a fixture directory holding one forbidden import and one `Date.now()` in a fake `core` file, and asserts they *fail*. Otherwise a misconfigured rule passes silently for ever.

### PR 0.2 — Supabase local and migrations CI

- `packages/db/supabase/` (the spec puts migrations in `db`; scripts pass `--workdir packages/db`). `config.toml` with the project settings pinned.
- Baseline migration `0000_extensions.sql`: `pgmq`, `pg_cron`, `pgcrypto`, `pgtap` (test only). Enabling them now proves the local image supports P4's building blocks before M4 depends on them.
- pgTAP harness (`supabase test db`) with one smoke test: the extensions exist. M2's RLS and append-only tests land here.
- `packages/db/src/types.gen.ts` from `supabase gen types typescript --local`, committed.
- CI job `db`: `supabase start`, `supabase db reset`, `supabase test db`, regenerate types and fail on any diff.
- `pnpm db:reset`, `pnpm db:test`, `pnpm db:types` scripts, documented in `CLAUDE.md`.
- **Remote deployment of migrations:** a separate `migrate.yml` workflow, triggered on merge to `main`, that runs `supabase db push` against the hosted project from a GitHub *environment* with a required reviewer (M0-Q3). In M0 it has only the baseline migration to push.

### PR 0.3 — `apps/web` and Vercel

- Next.js (App Router, current stable), React, strict TS, a single placeholder page that renders the capability line from the spec, and `transpilePackages` for `@faff/*`.
- `apps/web/content/claims.ts` created empty with a header comment: changes need review (I-12). A `CODEOWNERS` entry makes that review required.
- CI job `build-web`: `next build`.
- Vercel project linked to the repo, root directory `apps/web`, function region `lhr1` (next to Supabase London), preview deployment per PR. Env vars point previews at the **dev** Supabase project and production at **prod** (M0-Q2).

### PR 0.4 — `apps/worker` skeleton

- Fastify server: `GET /healthz` (process up) and `GET /readyz` (can open a Postgres connection with the service role). Config parsed with zod at boot; the process exits with a clear message if a variable is missing.
- Graceful shutdown on `SIGTERM` (the runner will hold leases in M4; the pattern is set now).
- Multi-stage `Dockerfile`: esbuild bundle, `node:24-slim`, non-root user.
- CI job `build-worker`: `docker build`, then run the image and `curl /healthz` inside the job.
- **If P7 is accepted:** a `fly.toml` (region `lhr`, one machine, health check on `/healthz`) and a manual `deploy-worker.yml` workflow. See M0-Q1.

### Owner / account tasks (no PR)

These create accounts or spend money, so they need the owner's go-ahead. The Supabase and Vercel connectors in this environment can do the first two on request.

- [ ] Create **two** Supabase projects in London (`eu-west-2`): `faff-dev` and `faff-prod`. Never reuse `dishton` ([01](../../spec/01-architecture.md#stack-q30)).
- [ ] Create the Vercel project and link it to the repo.
- [ ] Create the Fly.io app (if P7 is accepted).
- [ ] Add repo secrets: `SUPABASE_ACCESS_TOKEN`, DB passwords and project refs for both projects, `FLY_API_TOKEN`.
- [ ] Branch protection on `main`: require the CI jobs from 0.1–0.4, require one review.

---

## 6. Exit criteria

M0 is done when all of these are true:

- [ ] A fresh clone runs `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` with no errors.
- [ ] `pnpm db:reset` succeeds against a clean local Supabase, and `pnpm db:test` passes.
- [ ] Every CI job is green on `main`, and branch protection requires them.
- [ ] The rails self-test proves that a forbidden import in `core`, a `Date.now()` in `core`, and an `agents → db` import each fail CI.
- [ ] Generated DB types match the migrations (CI diff check).
- [ ] A Vercel preview deploy exists for the web placeholder.
- [ ] The worker image builds and answers `/healthz` in CI (and on Fly, if M0-Q1 says deploy).
- [ ] gitleaks runs on every PR.
- [ ] Total CI wall time under 5 minutes.

## 7. Invariants and graders touched

None directly. M0 builds the **enforcement scaffolding** later invariants rely on:

- The dependency matrix is the structural half of D3 / I-7 (`agents` can't reach `db`, so profile values can only arrive through `tools`).
- The `core` purity lint is the precondition for I-9's "deterministic, not an LLM judgement": a pure function that reads the clock isn't deterministic.
- `CODEOWNERS` on `claims.ts` is the start of I-12's "a review is required to change them".

## 8. Questions for the owner

Each has a default; silence means the default.

| # | Question | Default |
|---|---|---|
| **M0-Q1** | Accept **P7** (worker on Fly.io, London)? And deploy the health-check skeleton in M0, or wait until M4 when the worker does something? | Accept P7 and deploy in M0. A deployed `/readyz` flushes out secrets and networking to Supabase while nothing depends on them yet. Cost is one small machine |
| **M0-Q2** | Environments: local + `faff-dev` + `faff-prod`, with Vercel previews on dev? | Yes. Pointing previews at the only database is a bad habit to start, even owner-only (G6). Two projects fit Supabase's free tier |
| **M0-Q3** | Migrations to prod: automatic on merge, or behind a required approval? | Required approval (GitHub environment). Migrations are the one deploy that can't be rolled back by redeploying |
| **M0-Q4** | Should I create the Supabase and Vercel projects through the connectors, or will you? | You say which. I won't create cloud resources without a yes |
