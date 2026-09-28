# Project Status

Last updated: 2026-09-28

## Current milestone

**BUILDER UI** — core question CRUD/reorder/settings + autosave done
and verified end-to-end against a real local Supabase instance. Next
up: theming, logic builder, presentation modes, preview, publishing.

## Completed

- [x] Foundation: Next.js 16 (App Router, TS strict, Tailwind v4),
      shadcn/ui, Vitest/Testing Library/Playwright, ESLint/Prettier,
      CI workflow, governing docs (CLAUDE.md, ARCHITECTURE.md,
      DECISIONS.md, docs/\*).
- [x] Canonical form schema (`src/domains/forms/schema`): versioned Zod
      schema (all 16 Phase 1 question types + welcome/statement),
      structural/semantic validation, publication compiler with
      inescapable-loop (Tarjan SCC) and reachability checks.
- [x] Shared logic engine (`src/domains/logic`): single
      `evaluateNextStep`/`walkForm` used by both preview and the
      public runtime (not built yet, but the engine is ready and
      tested).
- [x] Pure domain helpers: response state machine + revision-monotonic
      guard (`src/domains/responses`), CSV export with formula-
      injection guarding and a documented 10k-row bound
      (`src/domains/exports`), completion-rate analytics that exclude
      preview traffic (`src/domains/analytics`), question/option
      factory + array reorder/duplicate/insert/remove helpers
      (`src/domains/forms/builder`).
- [x] Local Supabase project running (Docker, `supabase start`).
      Migrations 1–8 applied: profiles/workspaces/workspace_members
      (with `is_workspace_member`/`workspace_role_for` RLS helpers),
      forms/form_versions (draft-uniqueness + publish-immutability
      triggers + a `revision` counter for autosave CAS), responses/
      answers/uploads (status state-machine + revision-monotonic
      triggers), integrations/analytics/templates, storage buckets
      (private response-uploads, public theme-assets), atomic
      `create_workspace_with_owner` RPC, and explicit Data-API grants
      (this Supabase version does not auto-expose new tables — see
      DECISIONS.md).
- [x] Supabase client helpers: browser/server/admin clients,
      session-refresh proxy (`src/proxy.ts` — Next 16 renamed
      `middleware.ts`, see DECISIONS.md), generated
      `database.types.ts`.
- [x] Auth: signup (with email verification), login, logout, forgot/
      reset password, typed error mapping, `requireUser()` as the real
      server-side authorization boundary (proxy redirect is UX only).
      Verified live end-to-end against local Postgres.
- [x] Workspaces: `ensureDefaultWorkspace` auto-provisions a workspace + owner membership on first dashboard visit, via the atomic RPC.
      Fixed a real RLS/`RETURNING` bug found during live testing — see
      DECISIONS.md.
- [x] Dashboard: empty state, form list (draft/published badge,
      response count placeholder, last-updated), create-form action.
- [x] **Builder UI** (`src/app/(builder)/forms/[id]`, moved out of the
      `(dashboard)` route group so it gets its own full-screen chrome
      instead of the dashboard header/nav — same URL, `/forms/[id]`,
      unaffected since route groups don't change the URL):
  - Three-pane layout: question list (left), editable question/ending
    preview (center), type-specific settings (right), top bar with
    save status + disabled Preview/Publish (tooltipped "Coming soon"
    — those are separate upcoming milestones, not broken links).
  - Question CRUD: add (dropdown of all 15 addable types with icons),
    delete, duplicate, reorder. Reorder and all row actions are
    **keyboard-reachable, not hover-only** — this was a real bug
    found during live testing (buttons were `hidden group-hover:flex`,
    which removes them from the tab order entirely; fixed to
    `opacity-0` + `focus-within`/`group-focus-within` so Tab reaches
    them). See DECISIONS.md.
  - Type-specific settings editors for all 16 question types
    (text length limits, number min/max, options editor for
    select/multi-select/dropdown with add/remove, yes/no labels, date
    range, rating scale, opinion scale range + labels, file upload
    accepted types + max size, welcome/statement button label).
  - Non-interactive live preview control per type
    (`question-preview-control.tsx`) so the center pane is a real
    WYSIWYG of what the respondent will see.
  - Basic ending editor (title/description/button/redirect URL) —
    multiple endings and jump-to-ending logic land with the logic
    builder milestone.
  - Autosave: debounced (800ms) `saveDraftAction` server action →
    `saveDraftSchema` domain function, which re-validates
    (structural + semantic, not full publish-compile) and does a
    compare-and-set update (`where revision = :expected`) against the
    new `form_versions.revision` column. In-flight-save mutex so rapid
    edits don't race each other; a detected stale write (another tab)
    surfaces "Edited elsewhere — reload to continue" and stops
    autosaving until the page is reloaded, rather than silently
    overwriting.
  - **Verified live end-to-end**: created a question, edited its
    label, saw "Saved" appear, confirmed the exact label and
    incremented revision in Postgres via `psql`; added a
    `single_select` question via the dropdown, edited its options;
    reordered questions via the (keyboard-reachable) move-up button
    and confirmed the new `order` values persisted correctly; checked
    the browser console for errors (none).
- [x] 50/50 unit tests, lint, typecheck, and `next build` all green.

## In progress / next actions (in order)

1. Presentation modes (conversational P0, classic P1) sharing one data
   model — this affects the _public runtime_, not the builder; the
   builder's question list/settings already work for either mode.
2. Theming UI wired to `ThemeV1` + live preview (currently the builder
   center pane doesn't reflect theme colors/fonts yet).
3. Logic builder UI wired to `LogicRuleV1` + the existing logic
   engine, plus multi-ending support in the builder (add/remove
   endings, not just edit the one that exists).
4. Preview mode (desktop/mobile), isolated from production analytics —
   currently the Preview button is a disabled stub.
5. Publishing pipeline: draft → `compileFormSchema` → new immutable
   `form_versions` row (status=published), unpublish, republish —
   currently the Publish button is a disabled stub.
6. Public runtime (`src/app/f/[slug]`): server-authoritative render,
   uses the same logic engine, no respondent auth.
7. Partial response engine: `POST /api/responses/start`,
   `PATCH /api/responses/:id/answers` (revision-guarded),
   `POST /api/responses/:id/complete` (idempotency-key guarded),
   resume on refresh.
8. Response dashboard (table, detail view, delete) + CSV export route.
9. Resend email notifications on completion.
10. Webhooks (HMAC-signed, retry with backoff, delivery log UI) +
    Google Sheets integration.
11. PostHog analytics wiring (event instrumentation +
    `computeCompletionRate` surfaced in the dashboard).
12. ~20-30 templates + template picker.
13. Abuse/rate-limiting on public endpoints, accessibility pass,
    responsive polish (the builder itself is currently desktop-only
    layout, per spec — "Builder can prioritize desktop/tablet").
14. Security hardening + adversarial review pass (see spec's
    quality_gate list).
15. Integration/E2E test suites (`docs/testing.md`), full validation
    run, final report.

## Known bugs

None currently open. Two were found and fixed via live testing this
session (kept as notes since they're non-obvious): the RLS/`RETURNING`
interaction (see previous milestone's note, still in DECISIONS.md),
and the hover-only row-action-buttons accessibility bug described
above.

## How to resume

1. Read `CLAUDE.md` → `ARCHITECTURE.md` → `DECISIONS.md`.
2. Check `git log --oneline -20`.
3. Start local Supabase if not running: `supabase start` (from the
   project root; requires Docker). `.env.local` already has the local
   keys — regenerate with `supabase status -o env` if it's ever
   restarted with a different project ref.
4. Run `npm run lint && npm run typecheck && npm run test`.
5. Continue with the next unchecked action above — presentation modes
   / theming.
