# Project Status

Last updated: 2026-09-27

## Current milestone

**AUTH + WORKSPACES + FORM CREATION** — done and verified end-to-end
against a real local Supabase instance. Next up: **BUILDER**.

## Completed

- [x] Foundation: Next.js 16 (App Router, TS strict, Tailwind v4),
      shadcn/ui, Vitest/Testing Library/Playwright, ESLint/Prettier,
      CI workflow, governing docs (CLAUDE.md, ARCHITECTURE.md,
      DECISIONS.md, docs/*).
- [x] Canonical form schema (`src/domains/forms/schema`): versioned Zod
      schema (all 16 Phase 1 question types + welcome/statement),
      structural/semantic validation, publication compiler with
      inescapable-loop (Tarjan SCC) and reachability checks. 13 unit
      tests.
- [x] Shared logic engine (`src/domains/logic`): single
      `evaluateNextStep`/`walkForm` used by both preview and the
      public runtime (not built yet, but the engine is ready and
      tested — 5 unit tests).
- [x] Pure domain helpers: response state machine + revision-monotonic
      guard (`src/domains/responses`), CSV export with formula-
      injection guarding and a documented 10k-row bound
      (`src/domains/exports`), completion-rate analytics that exclude
      preview traffic (`src/domains/analytics`). 15 unit tests.
- [x] Local Supabase project running (Docker, `supabase start`).
      Migrations 1–7 applied: profiles/workspaces/workspace_members
      (with `is_workspace_member`/`workspace_role_for` RLS helpers),
      forms/form_versions (draft-uniqueness + publish-immutability
      triggers), responses/answers/uploads (status state-machine +
      revision-monotonic triggers), integrations/analytics/templates,
      storage buckets (private response-uploads, public theme-assets),
      atomic `create_workspace_with_owner` RPC, and explicit Data-API
      grants (this Supabase version does not auto-expose new tables —
      see DECISIONS.md).
- [x] Supabase client helpers: browser/server/admin clients,
      session-refresh proxy (`src/proxy.ts` — Next 16 renamed
      `middleware.ts`, see DECISIONS.md), generated
      `database.types.ts`.
- [x] Auth: signup (with email verification), login, logout, forgot/
      reset password, typed error mapping
      (`src/domains/identity/errors.ts`), `requireUser()` as the real
      server-side authorization boundary (proxy redirect is UX only).
      Verified live: signup → `handle_new_user` trigger creates
      `profiles` row → session cookie set → protected-route redirect
      works → logout works.
- [x] Workspaces: `ensureDefaultWorkspace` auto-provisions a workspace
      + owner membership on first dashboard visit, via the atomic RPC.
      **Found and fixed a real bug**: Postgres requires `INSERT ...
      RETURNING` rows to also satisfy SELECT RLS policies, but the
      owner's `workspace_members` row doesn't exist yet inside that
      same RPC call — broadened the `workspaces` SELECT policy to
      `owner_id = auth.uid() OR is_workspace_member(id)`. See the fix
      in migration 1 and the note in DECISIONS.md.
- [x] Dashboard: empty state, form list (draft/published badge,
      response count placeholder, last-updated), create-form action.
- [x] Form creation: `createFormWithDraft` inserts `forms` +
      `form_versions` (status=draft) with a starter schema
      (welcome screen → one short-text question → default ending),
      slug-conflict retry loop.
- [x] Verified live end-to-end in the browser against local Postgres:
      signup → dashboard (auto-created workspace) → create form →
      draft persisted → builder placeholder page renders the new form.
- [x] 37/37 unit tests, lint, typecheck, and `next build` all green.

## In progress / next actions (in order)

1. **Builder UI** (`/forms/[id]`, replacing the current placeholder):
   question list (add/delete/duplicate/reorder incl. keyboard
   alternative), central editable preview, config panel, autosave
   (debounced, revision-guarded PATCH), save-status indicator.
2. Question-type-specific setting editors for all 16 types.
3. Presentation modes (conversational P0, classic P1) sharing one data
   model.
4. Theming UI wired to `ThemeV1` + live preview.
5. Logic builder UI wired to `LogicRuleV1` + the existing logic engine.
6. Preview mode (desktop/mobile), isolated from production analytics.
7. Publishing pipeline: draft → `compileFormSchema` → new immutable
   `form_versions` row (status=published), unpublish, republish.
8. Public runtime (`src/app/f/[slug]`): server-authoritative render,
   uses the same logic engine, no respondent auth.
9. Partial response engine: `POST /api/responses/start`,
   `PATCH /api/responses/:id/answers` (revision-guarded), `POST
   /api/responses/:id/complete` (idempotency-key guarded), resume on
   refresh.
10. Response dashboard (table, detail view, delete) + CSV export route.
11. Resend email notifications on completion.
12. Webhooks (HMAC-signed, retry with backoff, delivery log UI) +
    Google Sheets integration.
13. PostHog analytics wiring (event instrumentation +
    `computeCompletionRate` surfaced in the dashboard).
14. ~20-30 templates + template picker.
15. Abuse/rate-limiting on public endpoints, accessibility pass,
    responsive polish.
16. Security hardening + adversarial review pass (see spec's
    quality_gate list).
17. Integration/E2E test suites (`docs/testing.md`), full validation
    run, final report.

## Known bugs

None currently open. (The RLS/RETURNING bug above was found and fixed
in this session — kept here as a note since it's a non-obvious Postgres
RLS behavior worth remembering if similar "insert ... returning" RPCs
are added later.)

## How to resume

1. Read `CLAUDE.md` → `ARCHITECTURE.md` → `DECISIONS.md`.
2. Check `git log --oneline -20`.
3. Start local Supabase if not running: `supabase start` (from the
   project root; requires Docker). `.env.local` already has the local
   keys — regenerate with `supabase status -o env` if it's ever
   restarted with a different project ref.
4. Run `npm run lint && npm run typecheck && npm run test`.
5. Continue with the next unchecked action above — the builder UI.
