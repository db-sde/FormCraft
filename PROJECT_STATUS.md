# Project Status

Last updated: 2026-09-28

## Current milestone

**EMAIL NOTIFICATIONS** — done and verified live against local
Postgres/dev server. Next up: webhooks + Google Sheets integration,
then analytics wiring.

## Completed

- [x] Foundation through file uploads + response dashboard — auth,
      workspaces, dashboard, full builder UI, preview, publishing, the
      public runtime, partial responses, file uploads, response
      dashboard + CSV export. See earlier milestones in git history
      and `ARCHITECTURE.md`/`DECISIONS.md`.
- [x] **Email notifications** (`src/domains/notifications`):
  - `template.ts` `buildResponseCompletedEmail` — a pure, unit-tested
    function producing subject/html/text. HTML-escapes the
    creator-supplied form title before interpolating it (a real
    XSS-in-email guard, not boilerplate — form titles are free text).
    Links to the response detail page rather than embedding raw
    answers in the email body.
  - `queries.ts` — `notification_settings` read/write. No row = enabled
    (opt-out model, not opt-in — see DECISIONS.md).
  - `send.ts` `notifyFormOwnerOfCompletedResponse` — looks up the
    form's workspace owner's email (three simple sequential queries
    rather than a guessed PostgREST embed, since `workspaces`↔
    `profiles` has more than one FK path), builds the email, sends via
    Resend. Never throws — every failure mode (disabled, no API key,
    no owner email, send failure) returns a typed result instead, so a
    notification problem can never affect the respondent-facing
    response (ARCHITECTURE.md's "integrations are async side effects"
    principle, same as every other integration).
  - Wired into `POST /api/responses/:id/complete` via Next.js's
    `after()` — not a bare unawaited promise, which a serverless
    runtime can kill the instant the response is flushed, silently
    dropping the notification. `after()` is the documented mechanism
    for exactly this "run after responding" case.
  - Only fires on a genuine first-time completion, not on an idempotent
    retry: `completeResponse`'s result now carries `formId` and
    `alreadyCompleted`, and the route handler checks
    `!alreadyCompleted` before scheduling the notification — otherwise
    a retried `/complete` call (expected/normal per the idempotency
    design) would double-email the creator.
- [x] **Verified live**: completed a real response through the actual
      `/complete` endpoint with `RESEND_API_KEY` unset (the realistic
      local-dev state) and confirmed the request still returned 200
      with the response correctly marked `completed` — the missing-API-
      key path degrades gracefully exactly as designed, with no crash
      and no effect on the response write. Confirmed via `psql` that no
      `notification_settings` row is required for the default-enabled
      path to be exercised (zero rows existed, and the send attempt
      still proceeded past the `enabled` check to the API-key check).
- [x] Strengthened the response-engine integration tests to assert the
      new `formId`/`alreadyCompleted` fields directly (not just that
      `ok` is `true`), including a real regression check that a retried
      `/complete` call is flagged `alreadyCompleted: true` — exactly
      the flag the route handler depends on to avoid double-notifying.
- [x] 87/87 unit tests + 5/5 integration tests, lint, typecheck, and
      `next build` all green.

## In progress / next actions (in order)

1. Webhooks (HMAC-signed, retry with backoff, delivery log UI) +
   Google Sheets integration — same "async side effect after the
   canonical write" principle as notifications, same `after()`
   mechanism. `webhook_endpoints`/`webhook_deliveries`/
   `sheets_connections`/`sheets_sync_log` tables already exist in the
   schema, unused so far.
2. PostHog analytics wiring (event instrumentation +
   `computeCompletionRate`, already implemented and tested, surfaced
   in the dashboard) — tag preview vs. real traffic (preview still
   makes zero network calls today, so there's nothing to mistag, but
   real `form_viewed`/`form_started`/`form_submitted` events need to
   start firing from the public runtime and its API routes).
3. ~20-30 templates + template picker (`templates` table already
   exists, unused so far).
4. Abuse/rate-limiting polish (the in-memory limiter is single-instance
   only — fine for now, documented upgrade path to a shared store),
   accessibility pass, responsive polish for the public runtime and
   dashboard on mobile.
5. Security hardening + adversarial review pass (see spec's
   quality_gate list) — replay/duplicate-submit/stale-write behavior
   is already tested at the domain layer; this pass should specifically
   try to break the HTTP layer (forged response/upload ids across
   forms, oversized payloads, malformed answer shapes, XSS in
   free-text answers rendered in the response dashboard).
6. E2E test suite (`docs/testing.md`), full validation run, final
   report.

## Known bugs

None currently open.

## How to resume

1. Read `CLAUDE.md` → `ARCHITECTURE.md` → `DECISIONS.md`.
2. Check `git log --oneline -20`.
3. Start local Supabase if not running: `supabase start` (from the
   project root; requires Docker). `.env.local` already has the local
   keys — regenerate with `supabase status -o env` if it's ever
   restarted with a different project ref.
4. Run `npm run lint && npm run typecheck && npm run test && npm run
test:integration`.
5. Continue with the next unchecked action above — webhooks, then
   Google Sheets.
