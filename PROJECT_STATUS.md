# Project Status

Last updated: 2026-09-28

## Current milestone

**PARTIAL RESPONSE ENGINE** — done and verified end-to-end against a
real local Supabase instance, including resume-after-refresh in an
actual browser. Next up: response dashboard + CSV export.

## Completed

- [x] Foundation, canonical form schema, shared logic engine, pure
      domain helpers, auth/workspaces/dashboard, full builder UI
      (question CRUD, theming, logic), preview mode, publishing
      pipeline, and the public runtime shell — see earlier milestones
      in git history and `ARCHITECTURE.md`/`DECISIONS.md`.
- [x] Local Supabase running (Docker). Migrations 1–10 applied,
      including `service_role` grants (found via live testing — same
      root cause as an earlier `authenticated`/`anon` grants bug: this
      Supabase version doesn't auto-expose new tables to _any_ Data
      API role, service_role included; see DECISIONS.md).
- [x] **Rate limiting** (`src/domains/abuse/rate-limit.ts`): a bounded,
      in-memory fixed-window limiter (capped tracked-key count, expired
      entries evicted) applied to all three public response endpoints.
      Documented as a single-instance limiter with a shared-store
      upgrade path noted for a scaled deployment. Unit-tested including
      fake-timer window-expiry behavior.
- [x] **Response engine domain** (`src/domains/responses/queries.ts`):
  - `startResponse` — resolves the form's _currently published_
    version server-side (never client-supplied), creates the
    `in_progress` row.
  - `saveResponseAnswers` — the UPDATE's own WHERE clause (`status <>
'completed' AND client_revision < :incoming`) is the actual
    compare-and-set guard, not a read-then-write check; a 0-rows
    result triggers one precise follow-up read to distinguish
    not-found / already-completed (benign no-op) / genuinely stale
    (rejected). Moves `in_progress` → `partial` on first save.
  - `completeResponse` — idempotent (an already-completed response
    returns its recorded ending without re-validating or re-writing
    anything, so a retried request after a dropped network response
    never errors); computes the ending server-side via the same
    `walkForm` used elsewhere (never trusts a client-supplied ending);
    validates required-and-reached questions from the actual logic
    path taken, not just "required" in isolation; handles a two-tab
    completion race by reporting whichever request's ending actually
    got recorded.
  - Answers persisted with the required-field/reachability check
    happening against them, not a separately-trusted client blob.
- [x] **Public API route handlers** (`src/app/api/responses/*`):
      `POST start`, `PATCH [id]/answers`, `POST [id]/complete`, matching
      `docs/api.md`'s documented contract. Zod-validated bodies, a
      200KB request-size cap before validation even runs, consistent
      `{ error: { code, message } }` shape, rate-limited per IP+form or
      IP+response.
- [x] **`FormRuntime` extended** (`src/components/runtime/form-runtime.tsx`)
      with optional `initialAnswers`/`initialQuestionId`/`initialHistory`
      props and an `onAnswerChange` callback, alongside the existing
      `onComplete` — all optional, so the builder's Preview dialog
      (which passes none of them) is unaffected. The component itself
      still makes no network calls; it only reports state changes.
- [x] **`PublicFormRuntime`** (`src/app/f/[slug]/public-form-runtime.tsx`):
      owns the actual response lifecycle for `/f/[slug]` — calls
      `/start` once per fresh session (guarded against React Strict
      Mode's double-effect in dev, which was caught creating duplicate
      rows before the fix — see below), debounces `onAnswerChange`
      into `PATCH .../answers` (600ms), calls `POST .../complete` from
      `onComplete`, and persists/reads a small resume record
      (`responseId`, `idempotencyKey`, `revision`, `answers`,
      `lastQuestionId`) in localStorage keyed by form id. A 409 stale
      response clears the cached state and reloads into a fresh
      response rather than risking a silent overwrite. Known Phase 1
      gap: the Back-button history stack isn't restored on resume (see
      DECISIONS.md) — position and answers are.
- [x] **Found and fixed a real duplicate-response bug** via live
      testing: the `/start` call fired twice on a fresh (no
      localStorage yet) page load because of React Strict Mode's
      dev-only double-effect-invocation, creating two `in_progress`
      rows for one page view. Fixed with a `useRef` in-flight guard
      that persists across the double-invocation (refs survive
      StrictMode's mount→cleanup→remount of the same instance).
      Confirmed via `psql`: exactly one row after the fix, versus two
      before it.
- [x] **5 integration tests** (`tests/integration/responses.test.ts`,
      run via `npm run test:integration` against real local Postgres
      using the service-role client, the same way the route handlers
      do): happy path start→autosave→complete; a stale out-of-order
      autosave is rejected without corrupting the newer stored value;
      completion is rejected with the specific missing question id
      when a reachable required question is unanswered; completion is
      idempotent (retry with the same key returns the same ending);
      a completed response can never be regressed to partial by a late
      autosave arriving after submission.
- [x] **Verified live end-to-end in a real browser**, unauthenticated,
      against local Postgres: opened the published form, confirmed
      exactly one response row was created; typed an answer and
      confirmed it autosaved (`status` → `partial`, correct revision,
      correct value) within ~1s; did a genuine browser navigation
      refresh mid-form and confirmed it resumed at the exact question
      with the exact answer already filled in (not a restart); pressed
      OK to complete and confirmed `status` → `completed` with
      `ending_id`, `completed_at`, and `idempotency_key` all set, and
      that localStorage was cleared afterward; checked the console for
      errors (none — only expected dev-mode HMR websocket noise).
- [x] 69/69 unit tests + 5/5 integration tests, lint, typecheck, and
      `next build` all green.

## In progress / next actions (in order)

1. File upload wiring for `file_upload` questions — currently captures
   a filename locally only; needs actual upload to the private
   `response-uploads` Storage bucket plus an `uploads` row, server-side
   size/type validation (never trusting the browser-supplied MIME
   type), and wiring into the answers payload.
2. Response dashboard (table, detail view, delete) + CSV export route
   (`src/domains/exports/csv.ts` already exists and is tested — this
   wires it to a real query + route handler). Needs a query that joins
   `responses`+`answers` efficiently with pagination (never fetch an
   unbounded table into the browser, per spec).
3. Resend email notifications on completion — hook into
   `completeResponse`'s success path as an async side effect that
   can't fail the response write itself.
4. Webhooks (HMAC-signed, retry with backoff, delivery log UI) +
   Google Sheets integration — same "async side effect after the
   canonical write" principle as notifications.
5. PostHog analytics wiring (event instrumentation +
   `computeCompletionRate`, already implemented and tested, surfaced
   in the dashboard) — tag preview vs. real traffic (preview still
   makes zero network calls today, so there's nothing to mistag, but
   real `form_viewed`/`form_started`/`form_submitted` events need to
   start firing from the public runtime and its API routes).
6. ~20-30 templates + template picker.
7. Abuse/rate-limiting polish (the in-memory limiter is single-instance
   only — fine for now, documented upgrade path to a shared store),
   accessibility pass, responsive polish for the public runtime on
   mobile.
8. Security hardening + adversarial review pass (see spec's
   quality_gate list) — replay/duplicate-submit/stale-write behavior
   is already tested at the domain layer; this pass should specifically
   try to break the HTTP layer (forged response ids across forms,
   oversized payloads, malformed answer shapes, XSS in free-text
   answers rendered later in the response dashboard once it exists).
9. E2E test suite (`docs/testing.md`), full validation run, final
   report.

## Known bugs

None currently open. Two were found and fixed via live testing this
session: the `service_role` grants gap, and the React Strict Mode
duplicate-`/start`-call bug — both recorded in DECISIONS.md.

## How to resume

1. Read `CLAUDE.md` → `ARCHITECTURE.md` → `DECISIONS.md`.
2. Check `git log --oneline -20`.
3. Start local Supabase if not running: `supabase start` (from the
   project root; requires Docker). `.env.local` already has the local
   keys — regenerate with `supabase status -o env` if it's ever
   restarted with a different project ref.
4. Run `npm run lint && npm run typecheck && npm run test && npm run
test:integration`.
5. Continue with the next unchecked action above — file upload wiring,
   then the response dashboard.
