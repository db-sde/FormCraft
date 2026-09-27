# Project Status

Last updated: 2026-09-27

## Current milestone

**FOUNDATION** — project bootstrap in progress.

## Completed

- [x] Repo inspected (was empty), Git initialized.
- [x] Next.js 16 (App Router, TS strict, Tailwind v4, src dir, `@/*`
      alias) scaffolded via `create-next-app` into project root.
- [x] Core dependencies installed: `@supabase/supabase-js`,
      `@supabase/ssr`, `zod`, `react-hook-form`, `@hookform/resolvers`,
      `resend`, `posthog-js`, `posthog-node`, `@sentry/nextjs`,
      `date-fns`, `nanoid`, `sonner`, Radix primitives, etc.
- [x] Dev/test tooling installed: `vitest`, `@testing-library/*`,
      `jsdom`, `@playwright/test`, `prettier` (+ tailwind plugin),
      `tsx`, `dotenv`.
- [x] shadcn/ui initialized (Radix base, Nova preset) with a broad
      component set added (button, input, select, dialog, tabs,
      table, form primitives, etc). Note: this shadcn CLI version does
      not ship a `form.tsx` wrapper for the Radix base — forms are
      built directly with `react-hook-form` + `zodResolver` instead of
      the classic shadcn `<Form>` wrapper.
- [x] `.gitignore` fixed so `.env.example` is trackable despite the
      `.env*` ignore rule.
- [x] Domain-driven directory skeleton created under `src/domains/*`,
      route groups under `src/app/*`, `supabase/migrations`,
      `tests/{unit,integration,e2e}`, `docs/`.
- [x] `CLAUDE.md` written with durable rules.

## In progress / next actions (in order)

1. Write `.env.example`, `ARCHITECTURE.md`, `DECISIONS.md`,
   `docs/database.md`, `docs/form-schema.md`, `docs/api.md`,
   `docs/testing.md`.
2. Configure `vitest.config.ts`, `playwright.config.ts`, `prettier`
   config, `tsconfig` path checks, `npm run typecheck` script, CI
   workflow (`.github/workflows/ci.yml`).
3. First commit of the foundation.
4. Supabase project wiring: `src/lib/supabase/{client,server,middleware}.ts`,
   initial migration (`users`/`profiles` extension, `workspaces`,
   `workspace_members`).
5. Auth domain: signup, email verification, login, logout, forgot/
   reset password, session middleware, protected route layout.
6. Workspace + authorization domain, RLS policies, cross-workspace
   isolation tests.
7. Canonical form schema (Zod) + `form_versions` persistence model.
8. Builder UI, question types, presentation modes, theming, logic
   engine, preview.
9. Publishing pipeline (draft → validate/compile → immutable version).
10. Public runtime (`/f/[slug]`), partial response engine (autosave,
    resume, idempotent completion).
11. Response dashboard, CSV export.
12. Email notifications (Resend), webhooks, Google Sheets integration.
13. Analytics (PostHog) + in-app analytics summary.
14. ~20-30 templates.
15. Abuse/rate-limiting, accessibility pass, responsive polish.
16. Security hardening + adversarial review pass.
17. E2E suite, full validation run, final report.

## Known bugs

None yet — implementation not started.

## Architecture decisions pending

See `DECISIONS.md` once created (not yet written as of this update).

## How to resume

Read `CLAUDE.md` → `ARCHITECTURE.md` → `DECISIONS.md`, check
`git log --oneline -20`, run `npm run lint && npm run typecheck &&
npm run test`, then continue with the next unchecked action above.
