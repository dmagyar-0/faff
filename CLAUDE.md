# Faff — notes for agents working in this repo

Faff is a UK consumer web app that books, reschedules and cancels appointments by phone and email, through an agent that always says it's an AI. The spec is written for you (Q8). Read it before changing behaviour.

## Read first

1. [`docs/spec/00-invariants.md`](docs/spec/00-invariants.md): the rules I-1 to I-12. No change may break one. An invariant enforced only by a prompt isn't enforced.
2. [`docs/design/implementation-plan.md`](docs/design/implementation-plan.md): how it's built, and the build order.
3. The plan for the milestone you're working on: [`docs/design/milestones/`](docs/design/milestones/README.md).

**Decision records** in `docs/decisions/` are never edited once accepted. To change one, add a record that supersedes it and update the spec in the same PR.

## Commands

Node 24 (`.nvmrc`) and pnpm 10 (`packageManager`).

| Command | What it does |
|---|---|
| `pnpm install` | Install the workspace |
| `pnpm check` | Everything CI runs except the secret scan and the database job. Run it before pushing |
| `pnpm lint` | ESLint (zero warnings), including the `packages/core` purity rules and the Next rules for `apps/web` |
| `pnpm format` / `pnpm format:check` | Prettier (Markdown is excluded on purpose) |
| `pnpm typecheck` | `tsc -b` across the project references (typecheck only; nothing is emitted except declarations into `.tsbuild/`) |
| `pnpm test` / `pnpm test:coverage` | Vitest across every package |
| `pnpm deps` | dependency-cruiser: the workspace dependency matrix |
| `pnpm rails` | Proves the purity lint, the Next lint scope, the matrix and the `claims.ts` CODEOWNERS entry still catch known violations |

Tests sit next to the code as `*.test.ts`. Import `describe`/`it`/`expect` from `vitest` explicitly; there are no globals.

### Database

The Supabase project lives in `packages/db/supabase/`; the CLI is a root devDependency and every script passes `--workdir packages/db`. These need Docker, so they're not part of `pnpm check`; the CI `db` job runs them.

| Command | What it does |
|---|---|
| `pnpm db:start` / `pnpm db:stop` | Start or stop the local stack |
| `pnpm db:reset` | Rebuild the local database from `supabase/migrations/` |
| `pnpm db:test` | pgTAP tests in `supabase/tests/` (`supabase test db`) |
| `pnpm db:types` | Regenerate `packages/db/src/types.gen.ts` from the local database. Commit the result; CI fails on a diff |
| `pnpm db:rails` | Proves the type-drift check and pgTAP still catch a table no migration created |

- Change the schema only with a new migration file; never edit one that has reached `main`. Then run `pnpm db:reset && pnpm db:test && pnpm db:types`.
- Never edit `types.gen.ts` by hand.
- `pgtap` is test-only: tests enable it inside their own rolled-back transaction, never in a migration.
- `apps/worker/src/*.db.test.ts` need a database too, so `pnpm test` skips them by config and the CI `db` job runs them: `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm --filter @faff/worker test:db`.
- Migrations reach the hosted project (one for now, treated as prod) only through `.github/workflows/migrate.yml`, which runs automatically once CI passes on `main`. So a migration is live as soon as its PR merges: CI green on the PR is the only gate. Don't run `supabase db push` yourself.

### Worker

| Command | What it does |
|---|---|
| `pnpm --filter @faff/worker dev` | Run the worker from source with `apps/worker/.env` (copy `.env.example`) |
| `pnpm --filter @faff/worker build` | esbuild bundle to `apps/worker/dist/main.mjs` |
| `docker build -f apps/worker/Dockerfile -t faff-worker .` | The image, from the repo root. `apps/worker/scripts/smoke-image.sh faff-worker` is what CI's `build-worker` job runs on it |

Config is parsed with zod at boot (`src/config.ts`); a missing variable stops the process with its name. Anything that holds a resource registers a step in `src/main.ts`'s shutdown list, in the order it must close. The worker deploys to Fly (`apps/worker/fly.toml`) only through the manual `deploy-worker.yml` workflow.

### Web

`pnpm --filter @faff/web dev` / `build` run Next.js (App Router) from `apps/web` (env: copy `.env.example` to `.env.local`). Vercel builds it with root directory `apps/web`, functions in `lhr1`, a preview deployment per PR. Previews and production share the one hosted Supabase project for now (M0-Q2).

**Capability claims (I-12):** every user-facing string about what Faff can or can't do lives in `apps/web/content/claims.ts`, never inline in a component. `.github/CODEOWNERS` makes a review required to change it; the rails self-test fails if that entry goes.

## Layout and the dependency matrix

Internal packages export TypeScript source (`"exports": { ".": "./src/index.ts" }`); there's no per-package build.

| Package | May import | Purpose |
|---|---|---|
| `packages/core` | nothing internal | Pure domain logic. Runtime deps limited to `zod`, `temporal-polyfill`, `@noble/hashes`, `canonicalize` |
| `packages/db` | core | Migrations, generated types, repositories |
| `packages/tools` | core, db | The tool server: the enforcement point (D3) |
| `packages/agents` | core, tools | Agents. **Never `db`**: data comes only through tools (I-7) |
| `packages/telephony` | core, sim | `CallProvider` and its providers |
| `packages/email` | core | Renderer (fixed signature) and inbound parser |
| `packages/sim` | core | Simulated callee personas, IVR trees, scenarios |
| `evals` | anything | Scenario runner and graders |
| `apps/web` | core, db, agents | Next.js app |
| `apps/worker` | everything but web | Runner, tools HTTP, webhooks |

`.dependency-cruiser.cjs` is the source of truth. Adding an edge means editing its `MATRIX`, the matching `package.json` and the `tsconfig.json` references, in a PR where review can see it.

## `packages/core` is pure

No network, clock, randomness, environment, console or database. Lint rejects `Date.now()`, `new Date()`, `Math.random()`, `Temporal.Now`, `fetch`, `process`, `crypto`, timers, `node:*` imports and any `@faff/*` import in `packages/core/src` (tests are exempt). Take `now`, IDs and data as arguments. This is what makes the property tests mean something, and what makes I-9's "deterministic, not an LLM judgement" true.

## Don't

- Commit secrets. Use `.env.example`; real values live in Vercel, Fly and GitHub secrets. CI runs gitleaks over the full history.
- Weaken a rule to make CI pass: the purity lint, the matrix, a coverage threshold, or the rails self-test. If a rule is wrong, change it on purpose in its own PR and say why.
- Put a model ID in code. Model IDs come from config (spec 01).
