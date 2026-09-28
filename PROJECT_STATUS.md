# Project Status

Last updated: 2026-09-28

## Current milestone

**THEMING + LOGIC BUILDER** — done and verified end-to-end against a
real local Supabase instance. Next up: presentation modes, preview,
publishing.

## Completed

- [x] Foundation: Next.js 16 (App Router, TS strict, Tailwind v4),
      shadcn/ui, Vitest/Testing Library/Playwright, ESLint/Prettier,
      CI workflow, governing docs (CLAUDE.md, ARCHITECTURE.md,
      DECISIONS.md, docs/\*).
- [x] Canonical form schema, shared logic engine (`evaluateNextStep`/
      `walkForm`), pure domain helpers (response state machine, CSV
      export, completion-rate analytics, form/question/ending/logic
      builder helpers) — see `src/domains/*`.
- [x] Local Supabase project running (Docker, `supabase start`).
      Migrations 1–8 applied (identity/workspaces, forms/versions with
      a `revision` CAS column, responses/answers/uploads, integrations/
      analytics/templates, storage buckets, workspace-creation RPC,
      explicit Data-API grants).
- [x] Auth (signup/login/logout/forgot/reset), workspace
      auto-provisioning, dashboard with create-form flow — all
      verified live against local Postgres.
- [x] **Builder UI** (`src/app/(builder)/forms/[id]`): question CRUD/
      reorder (keyboard-accessible) with type-specific settings for
      all 16 question types, non-interactive live preview control,
      basic ending editor, debounced revision-guarded autosave.
- [x] **Theming** (`src/domains/themes`, `theme-settings-panel.tsx`,
      `theme-preview.tsx`):
  - 6 built-in presets (Classic/Ocean/Forest/Sunset/Midnight/
    Monochrome), applied atomically (color+font+button style
    together) and cleared on any manual color override.
  - Color fields (native swatch + hex text input, validated), font
    family and button style selects, live-updating center-pane
    preview mockup styled with the actual theme (colors, font stack,
    button radius, background image).
  - Logo + background image upload straight to the public
    `theme-assets` Storage bucket (client-side type/size validation,
    RLS-scoped path `<workspace_id>/<form_id>/<file>`), with a
    remove button once uploaded.
  - WCAG contrast-ratio check (`src/domains/themes/contrast.ts`,
    unit-tested) surfaces an inline warning — not a hard block — when
    the primary color would be hard to read as white button text, or
    when text/background contrast is weak.
  - **Verified live**: selected the "Ocean" preset, watched colors/
    button shape update instantly in the preview, confirmed the exact
    theme object persisted in Postgres via `psql`.
- [x] **Logic builder** (`logic-editor.tsx`, `logic-value-control.tsx`):
  - Rule list, "IF [question] [operator] [value] THEN [jump to
    question/ending] [target]", rules evaluated top-to-bottom by the
    same engine used elsewhere (no separate logic implementation).
  - Operator choices narrow to what's meaningful for the source
    question's type (`availableOperators` — e.g. no `contains` on a
    text question, no `gt`/`lt` on a non-numeric one); this is a UX
    narrowing, not a new validation rule (the schema's own semantic
    validation is the actual enforcement).
  - The value control adapts to the question type: a real option
    picker for select/multi-select/dropdown (comparing by option id,
    not free text), yes/no picker, number input for numeric types,
    text input otherwise.
  - Multiple endings: add/remove UI (`createEnding`/`removeEnding`/
    `canDeleteEnding`) — an ending can't be deleted if it's the
    default or the last one remaining, matching the schema's
    "exactly one default, at least one ending" invariant.
  - **Deleting a question or ending that a logic rule depends on
    surfaces a confirmation dialog** ("N logic rule(s) reference this
    and will also be deleted") instead of silently leaving a dangling
    reference — the explicit Phase 1 requirement from
    docs/form-schema.md. Cascade-deletes the affected rules only on
    confirm.
  - **Verified live end-to-end**: added a rule, changed its operator
    to reveal the option-picker value control, selected an option,
    confirmed the exact rule (including the option id, not a label)
    persisted in Postgres; deleted the question that rule depended
    on, confirmed the warning dialog listed "1 logic rule", confirmed
    on delete that both the question AND the now-dangling rule were
    removed together in the persisted schema.
- [x] 65/65 unit tests, lint, typecheck, and `next build` all green.

## In progress / next actions (in order)

1. Presentation modes (conversational P0, classic P1) — affects the
   _public runtime_ (not built yet), not the builder itself.
2. Preview mode (desktop/mobile), isolated from production analytics —
   currently the Preview button is a disabled stub.
3. Publishing pipeline: draft → `compileFormSchema` (already written
   and tested — the inescapable-loop/reachability checks from the
   schema milestone) → new immutable `form_versions` row
   (status=published), unpublish, republish — currently the Publish
   button is a disabled stub.
4. Public runtime (`src/app/f/[slug]`): server-authoritative render,
   uses the same logic engine, no respondent auth.
5. Partial response engine: `POST /api/responses/start`,
   `PATCH /api/responses/:id/answers` (revision-guarded),
   `POST /api/responses/:id/complete` (idempotency-key guarded),
   resume on refresh.
6. Response dashboard (table, detail view, delete) + CSV export route.
7. Resend email notifications on completion.
8. Webhooks (HMAC-signed, retry with backoff, delivery log UI) +
   Google Sheets integration.
9. PostHog analytics wiring (event instrumentation +
   `computeCompletionRate` surfaced in the dashboard).
10. ~20-30 templates + template picker.
11. Abuse/rate-limiting on public endpoints, accessibility pass,
    responsive polish (the builder itself is desktop-only, per spec).
12. Security hardening + adversarial review pass (see spec's
    quality_gate list).
13. Integration/E2E test suites (`docs/testing.md`), full validation
    run, final report.

## Known bugs

None currently open.

## How to resume

1. Read `CLAUDE.md` → `ARCHITECTURE.md` → `DECISIONS.md`.
2. Check `git log --oneline -20`.
3. Start local Supabase if not running: `supabase start` (from the
   project root; requires Docker). `.env.local` already has the local
   keys — regenerate with `supabase status -o env` if it's ever
   restarted with a different project ref.
4. Run `npm run lint && npm run typecheck && npm run test`.
5. Continue with the next unchecked action above — preview mode, then
   publishing (the compiler it needs already exists and is tested).
