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
| `pnpm lint` | ESLint, including the `packages/core` purity rules |
| `pnpm format` / `pnpm format:check` | Prettier (Markdown is excluded on purpose) |
| `pnpm typecheck` | `tsc -b` across the project references (typecheck only; nothing is emitted except declarations into `.tsbuild/`) |
| `pnpm test` / `pnpm test:coverage` | Vitest across every package |
| `pnpm deps` | dependency-cruiser: the workspace dependency matrix |
| `pnpm schema:write` / `pnpm schema:check` | Write, or check for drift, `docs/spec/schemas/brief.v1.json` from the zod schema in `packages/core`. Commit the result; CI fails on a diff |
| `pnpm rails` | Proves the purity lint, the matrix and the schema drift check still catch known violations |

Tests sit next to the code as `*.test.ts`. Import `describe`/`it`/`expect` from `vitest` explicitly; there are no globals.

In `packages/core`, property tests use fast-check with at least 1,000 runs from a fixed seed (`packages/core/vitest.setup.ts`; set `FC_SEED` to try others). Each PR adds per-file coverage thresholds for the files it writes to the root `vitest.config.ts`; CI enforces them in `pnpm test:coverage`.

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
- Migrations reach the hosted project (one for now, treated as prod) only through `.github/workflows/migrate.yml`, which runs automatically once CI passes on `main`. So a migration is live as soon as its PR merges: CI green on the PR is the only gate. Don't run `supabase db push` yourself.

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
