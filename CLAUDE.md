# CLAUDE.md — Durable Project Instructions

This file is the durable, load-bearing reference for anyone (human or
Claude) working on this repository. It distills the Phase 1 product
spec into working rules. Read this, `PROJECT_STATUS.md`, and
`ARCHITECTURE.md` before resuming work after any context reset.

## What this is

**FormCraft** — a Typeform/Youform-style SaaS form builder. Creators
build and publish forms; respondents fill them out anonymously.
Phase 1 explicitly includes partial-response tracking (IN_PROGRESS /
PARTIAL / COMPLETED), not just completed submissions.

## Stack

- Next.js (App Router) + TypeScript (strict) + Tailwind v4 + shadcn/ui
- Supabase: Postgres, Auth, Storage (RLS everywhere)
- Resend (email), PostHog (product analytics), Sentry (errors)
- Vitest + Testing Library (unit/integration), Playwright (E2E)
- Modular monolith — no separate backend service, no Redis/Kafka/k8s
  unless a real, discovered requirement demands it.

## Non-negotiable rules

1. **Server is authoritative.** Never trust client-supplied workspace
   ownership, role, publication state, form schema, logic, or required
   flags. Every mutation: authenticate → establish identity → identify
   workspace → verify membership → verify permission → execute.
2. **Published versions are immutable.** Drafts are mutable. Responses
   reference the exact `form_versions.id` they were served from.
3. **Question IDs are stable identifiers**, independent of array
   position. Never use index as identity.
4. **RLS on every table** that holds tenant data. Service-role key
   never reaches browser code.
5. **Response state machine**: IN_PROGRESS → PARTIAL → COMPLETED only.
   A completed response never regresses. Enforce with a DB trigger/
   check constraint, not just application code.
6. **Idempotency**: final submission takes a client-generated
   idempotency key; duplicate submits must not create duplicate
   completed responses.
7. **Integrations are async side effects.** Webhook/Sheets failures
   must never invalidate or roll back a canonical response.
8. **No secrets committed.** `.env.example` documents every variable;
   real values live only in `.env.local` (gitignored) and the hosting
   provider's secret store.
9. **Do not invent Phase 2/3 features.** If a requirement is
   ambiguous, record the decision in `DECISIONS.md` and pick the
   simplest production-safe option.
10. **Preview/test traffic must never inflate production analytics.**
    Tag it and filter it out at the source.

## Commands

```bash
npm run dev          # local dev server
npm run build         # production build
npm run lint           # eslint
npm run typecheck       # tsc --noEmit
npm run test              # vitest run
npm run test:watch         # vitest watch
npm run e2e                  # playwright test
npm run format                # prettier --write
```

## Directory map

- `src/domains/*` — domain modules (forms, responses, logic, etc.),
  each owning its own types, validation, and data-access functions.
  UI code in `src/app` calls into domains; domains never import from
  `src/app`.
- `src/app` — Next.js routes: `(marketing)`, `(auth)`, `(dashboard)`,
  `f/[slug]` (public runtime), `api/*` (route handlers).
- `src/lib` — cross-cutting infra: Supabase clients, shared API
  helpers, shared validation primitives.
- `supabase/migrations` — the only source of schema truth. Never edit
  the DB by hand in a way that isn't captured in a migration.
- `docs/` — `database.md`, `form-schema.md`, `api.md`, `testing.md`.
- `tests/unit`, `tests/integration`, `tests/e2e`.

## Resuming after a context reset

1. Read `PROJECT_STATUS.md` for current milestone / next actions.
2. Read `ARCHITECTURE.md` and `DECISIONS.md` for the "why".
3. Run `git log --oneline -20` to see what actually landed.
4. Run `npm run lint && npm run typecheck && npm run test` to see
   current health before writing new code.
5. Continue from the exact next action listed — do not restart.
