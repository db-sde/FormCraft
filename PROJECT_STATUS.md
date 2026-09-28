# Project Status

Last updated: 2026-09-28

## Current milestone

**PREVIEW + PUBLISHING** — done and verified end-to-end against a real
local Supabase instance, including a genuine unauthenticated public
page. Next up: partial-response engine (autosave/resume/submit), then
the response dashboard.

## Completed

- [x] Foundation, canonical form schema, shared logic engine, pure
      domain helpers — see `src/domains/*` and earlier milestones.
- [x] Local Supabase running (Docker). Migrations 1–9 applied,
      including `publish_form_version` (atomic archive-then-insert RPC,
      row-locked to serialize concurrent publishes of the same form).
- [x] Auth, workspaces, dashboard, full builder UI (question CRUD,
      theming, logic) — all verified live against local Postgres.
- [x] **Shared interactive runtime** (`src/components/runtime`):
  - `runtime-question-input.tsx` — real, working inputs for all 16
    question types (distinct from the builder's disabled preview
    mockup), including an "Other" free-text option for select types.
  - `form-runtime.tsx` — the conversational (one-question-at-a-time)
    walker: required-field validation, Back/Next, Enter-to-advance
    (except in a textarea), a progress bar, ending screen with
    optional redirect, all driven by the exact same
    `evaluateNextStep`/`isAnswered` functions from `src/domains/logic`
    used elsewhere — so branching can't behave differently in preview
    vs. the real public form. Purely client-side/local state; no
    network calls, so it's inherently isolated from production
    analytics (nothing to filter — there's nothing sent).
  - This one component is now used by **both** the builder's Preview
    dialog (fed the in-memory draft, including unsaved edits) and the
    public runtime (fed the published version) — deliberately, so
    "what the creator previewed" and "what a respondent sees" can't
    drift apart.
- [x] **Preview** (`preview-dialog.tsx`): compiles the current draft
      client-side on open (full structural + semantic validation, not
      just a raw render) and shows a friendly "Can't preview yet: ..."
      message instead of crashing if the in-progress draft isn't
      publish-valid at that moment. Desktop/mobile width toggle.
- [x] **Publishing** (`domains/forms/queries.ts` `publishForm`/
      `unpublishForm`, `publish_form_version` RPC):
  - Publish re-validates the draft through the full pipeline
    (structural → semantic → the publication compiler from the schema
    milestone — reachability + inescapable-loop checks) before
    touching the database, and surfaces the specific validation error
    if it fails rather than a generic failure.
  - Archives the previous published version and inserts a new
    immutable one atomically; the draft row is never touched by
    publish, matching the versioning architecture (draft stays
    editable, published is immutable, "republish" is just calling
    publish again).
  - Unpublish archives the current published row with no replacement;
    the public runtime treats "no published row" as not-found (404),
    never as an error page.
  - Builder top bar wired: Publish/Republish button, Unpublish + "View
    live" links appear once published, toast notifications (success
    with a "View live" action, or the specific validation error) via
    sonner.
- [x] **Public runtime** (`src/app/f/[slug]`): a genuinely new,
      unauthenticated route — not a stub. Resolves the slug via
      anon-readable RLS (no service-role bypass needed), 404s for a
      missing or unpublished form, renders the real `FormRuntime`.
      Response persistence (autosave/submit) is intentionally not
      wired yet — that's the next milestone — so filling out the
      public form today walks through validation/branching/the ending
      screen correctly but doesn't save a response row.
- [x] **Verified live end-to-end**, unauthenticated, against local
      Postgres:
  - Preview dialog: welcome screen → typed an answer → pressed Enter
    → required-field validation exercised → reached the default
    ending, all inside the builder without any network writes.
  - Publish: draft stayed at version 1 untouched; a new `published`
    version 2 was created; confirmed via `psql`.
  - Opened `/f/<slug>` in the browser with no session: real published
    content rendered, required-field validation blocked an empty
    submit with the correct message, console had no errors.
  - Unpublish: version 2 flipped from `published` to `archived` (kept,
    not deleted); confirmed `/f/<slug>` now returns a real 404.
- [x] 65/65 unit tests, lint, typecheck, and `next build` all green.

## In progress / next actions (in order)

1. **Partial response engine**: `responses`/`answers` tables already
   exist with the state-machine + revision triggers from an earlier
   migration — this milestone wires them up. `POST
/api/responses/start` (creates `in_progress`), debounced
   `PATCH /api/responses/:id/answers` (revision-guarded, moves to
   `partial`), `POST /api/responses/:id/complete`
   (idempotency-key guarded, moves to `completed`, records
   `ending_id`). Wire `FormRuntime`'s existing `onComplete` seam (and
   add an `onAnswerChange` seam) to these instead of leaving answers
   purely local. Resume-on-refresh via a response id in the URL/
   localStorage.
2. File upload wiring for `file_upload` questions (currently captures
   a filename locally only — no actual upload to the private
   `response-uploads` bucket yet).
3. Response dashboard (table, detail view, delete) + CSV export route
   (`src/domains/exports/csv.ts` already exists and is tested — this
   wires it to a real query + route handler).
4. Resend email notifications on completion.
5. Webhooks (HMAC-signed, retry with backoff, delivery log UI) +
   Google Sheets integration.
6. PostHog analytics wiring (event instrumentation +
   `computeCompletionRate`, already implemented and tested, surfaced
   in the dashboard) — including tagging preview traffic so it's
   excluded, now that there's a real preview path to tag.
7. ~20-30 templates + template picker.
8. Abuse/rate-limiting on public endpoints (the `/api/responses/*`
   endpoints from item 1 are exactly what need it), accessibility
   pass, responsive polish for the public runtime on mobile (it's
   already reasonably responsive since it's a single centered column,
   but hasn't been explicitly tested at phone width).
9. Security hardening + adversarial review pass (see spec's
   quality_gate list) — once responses exist, this includes replay/
   duplicate-submit/stale-write testing against the real endpoints.
10. Integration/E2E test suites (`docs/testing.md`), full validation
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
5. Continue with the next unchecked action above — the partial
   response engine. `FormRuntime`'s `onComplete` prop
   (`src/components/runtime/form-runtime.tsx`) is the integration
   point; an `onAnswerChange` prop for debounced autosave will need to
   be added alongside it.
