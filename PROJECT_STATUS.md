# Project Status

Last updated: 2026-09-28

## Current milestone

**FILE UPLOADS + RESPONSE DASHBOARD** — done and verified end-to-end
against a real local Supabase instance, including an actual uploaded
file retrieved byte-for-byte through a signed URL. Next up: email
notifications, then webhooks/Google Sheets, then analytics wiring.

## Completed

- [x] Foundation through the partial response engine — auth,
      workspaces, dashboard, full builder UI, preview, publishing, the
      public runtime, and start/autosave/resume/complete — see earlier
      milestones in git history and `ARCHITECTURE.md`/`DECISIONS.md`.
- [x] **File upload wiring**:
  - `src/domains/uploads/sniff.ts` — magic-byte content-type detection
    (PNG/JPEG/GIF/WebP/PDF) with wildcard-group matching against a
    question's configured accept list. This is the actual "never trust
    the browser's declared MIME type" enforcement, unit-tested
    including a disguised-file case (plain text declared as
    `image/png`).
  - `src/domains/uploads/queries.ts` `recordUpload` — validates against
    the question's own `maxSizeMb`/`acceptedMimeTypes` from the
    _published schema_ (never the client), sniffs the real content
    type, writes to the private `response-uploads` bucket at a
    `<responseId>/<questionId>/<uuid>.<ext>` path (never the
    user-supplied filename, avoiding path traversal/spoofing), and
    records an `uploads` row. `getUploadSignedUrl` issues short-lived
    signed URLs for the creator dashboard (the bucket has no public/
    anon read policy at all).
  - `POST /api/responses/:id/uploads/:questionId` — multipart route
    handler, rate-limited, admin-client-backed (respondents have no
    session, same pattern as the other response endpoints).
  - `RuntimeQuestionInput`'s file control now actually uploads when a
    `responseId` is present (the real public runtime) and stores the
    _upload id_ as the answer value (never a raw file or public URL,
    per docs/api.md) — but stays purely local-state when no
    `responseId` is given (the builder's Preview dialog), preserving
    Preview's zero-network-calls guarantee.
- [x] **Response dashboard** (`src/domains/responses/dashboard.ts` +
      `src/app/(dashboard)/forms/[id]/responses/*`):
  - `listResponses` — paginated (25/page), completed-only by default,
    resolves each row's ending title against _that response's own_
    `form_version` schema (cached per version id within a page) so
    historical responses display correctly even after the form's been
    republished since.
  - `getResponseDetail` — full answer list run through
    `formatAnswerValue` (a new pure, unit-tested function shared with
    CSV export so the dashboard and export can never disagree about
    what an answer "means" — e.g. multi-select always shows joined
    option _labels_, never raw ids), with a formId cross-check so a
    same-workspace different-form response id in the URL 404s instead
    of rendering.
  - `deleteResponse`, `getResponseCounts` (completed/partial/
    in_progress, shown as a summary line rather than fetching every
    row).
  - `buildResponsesCsv` — reuses the already-tested `toCsv` (formula-
    injection guarding, 10k-row bound) with columns from the form's
    most-recent version and per-response cells resolved against each
    response's own version (see DECISIONS.md for why).
  - UI: response list with delete-with-confirmation
    (`DeleteResponseButton`, shared between list and detail pages),
    response detail page rendering uploaded files as download links via
    signed URLs, `GET /api/forms/:id/export.csv` (session-scoped, never
    the admin client — RLS plus an explicit workspace check), a
    "Responses" link added to the builder's top bar.
- [x] **Verified live end-to-end** against local Postgres:
  - Added a `file_upload` question, republished (confirmed via `psql`
    that the old published version archived and a new one appeared —
    versioning still correct after this milestone's changes).
  - Uploaded a real 1×1 PNG through the actual API route (multipart
    POST) — confirmed the `uploads` row and the Storage object both
    exist, then fetched the signed URL from the response detail page
    and confirmed the downloaded bytes are byte-for-byte the original
    PNG.
  - Attempted to upload a plain-text file with a spoofed
    `image/png` declared type — rejected with `unsupported_type`,
    confirming the magic-byte check (not the declared type) is what's
    actually enforced.
  - Completed the response via the real `/complete` endpoint and
    confirmed the response dashboard shows the correct count ("2
    responses... Plus 1 in-progress/partial session, not shown
    below"), correct ending titles, and the detail page renders the
    upload as a working link.
  - Confirmed `GET /api/forms/:id/export.csv` correctly redirects
    unauthenticated requests to `/login` (307, via `requireUser()`'s
    own redirect) rather than leaking any data.
- [x] 84/84 unit tests + 5/5 integration tests, lint, typecheck, and
      `next build` all green (this was the last validation run against
      the current code — no source changes since).

## In progress / next actions (in order)

1. Resend email notifications on completion — hook into
   `completeResponse`'s success path as an async side effect that
   can't fail the response write itself; respect the
   `notification_settings` table (already in the schema, unused so
   far) for enable/disable per form.
2. Webhooks (HMAC-signed, retry with backoff, delivery log UI) +
   Google Sheets integration — same "async side effect after the
   canonical write" principle as notifications. `webhook_endpoints`/
   `webhook_deliveries`/`sheets_connections`/`sheets_sync_log` tables
   already exist in the schema, unused so far.
3. PostHog analytics wiring (event instrumentation +
   `computeCompletionRate`, already implemented and tested, surfaced
   in the dashboard) — tag preview vs. real traffic (preview still
   makes zero network calls today, so there's nothing to mistag, but
   real `form_viewed`/`form_started`/`form_submitted` events need to
   start firing from the public runtime and its API routes).
4. ~20-30 templates + template picker (`templates` table already
   exists, unused so far).
5. Abuse/rate-limiting polish (the in-memory limiter is single-instance
   only — fine for now, documented upgrade path to a shared store),
   accessibility pass, responsive polish for the public runtime and
   dashboard on mobile.
6. Security hardening + adversarial review pass (see spec's
   quality_gate list) — replay/duplicate-submit/stale-write behavior
   is already tested at the domain layer; this pass should specifically
   try to break the HTTP layer (forged response/upload ids across
   forms, oversized payloads, malformed answer shapes, XSS in
   free-text answers rendered in the response dashboard — now that the
   dashboard exists and actually renders respondent-supplied text).
7. E2E test suite (`docs/testing.md`), full validation run, final
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
5. Continue with the next unchecked action above — email
   notifications, then webhooks/Sheets.
