# Project Status

Last updated: 2026-09-28

## Current milestone

**ANALYTICS** — done and verified live: `form_viewed`/`form_started`/
`form_submitted` events now actually fire (previously only the pure
`computeCompletionRate`/`computeFunnelSummary` math existed, with
nothing feeding it), and the responses dashboard shows a real
views/starts/completions/completion-rate funnel card. Google Sheets
integration is the one Phase 1 launch item still unimplemented (see
below — deliberately deferred, not forgotten). Next up: templates.

## Completed

- [x] Foundation through email notifications — auth, workspaces,
      dashboard, full builder UI, preview, publishing, the public
      runtime, partial responses, file uploads, response dashboard +
      CSV export, email notifications on completion. See earlier
      milestones in git history and `ARCHITECTURE.md`/`DECISIONS.md`.
- [x] **Webhooks** (`src/domains/webhooks`):
  - `signing.ts` — HMAC-SHA256 over the exact serialized payload
    string (signing must happen on the same bytes that are sent, never
    a re-serialization), plus a constant-time `verifySignature` for
    completeness. Unit-tested including a tamper-detection case (any
    mutation to the payload invalidates the signature).
  - `backoff.ts` — a genuinely bounded exponential schedule (1min →
    5min → 30min → 2hr → 12hr, then `exhausted`, never retried
    forever). Unit-tested for monotonic increase and exhaustion.
  - `payload.ts` — the one function that builds the
    `response.completed` event shape from docs/api.md, shared by the
    real dispatch path and the test-delivery path so they can never
    drift apart.
  - `queries.ts`:
    - `enqueueWebhookDeliveries` — inserts one `pending` row per
      _enabled_ endpoint on the form; enqueueing is deliberately
      separate from sending, so a slow/unreachable consumer can never
      affect the respondent-facing response.
    - `dispatchDueDeliveries` — the actual HTTP attempt (10s timeout,
      signed, bounded batch of 20), updating status/attempt_count/
      `next_attempt_at` per the backoff schedule, or `exhausted` once
      the schedule runs out.
    - `sendTestDelivery` — an immediate synthetic-payload send for the
      creator's "Test" button, intentionally **not** written to the
      delivery log (it's a connectivity check, not a real event).
  - **First attempt is immediate** (scheduled via `after()` right in
    `/api/responses/:id/complete`, same mechanism as email
    notifications); a separate `POST /api/cron/webhooks/dispatch`,
    gated by a `CRON_SECRET` bearer token (never a user session — see
    DECISIONS.md), covers retries later. This app has no long-running
    worker process, so that route needs an external scheduler (Vercel
    Cron / `pg_cron` / anything `curl`-on-a-timer) wired up at deploy
    time — documented in the route file and DECISIONS.md, not just
    assumed.
  - UI at `/forms/[id]/integrations`: add/enable-disable/delete
    endpoints, a signing secret shown once at creation (with a copy
    button), a "Test" button, and a per-endpoint delivery log (status
    badges, attempt count, timestamps). Linked from the builder's top
    bar next to "Responses".
  - **Found and fixed a real bug before it shipped**: the "show the
    signing secret once" UI called `window.location.reload()`
    immediately after creating the endpoint, which would have thrown
    away the secret before ever displaying it. Fixed by having the
    create action return the full endpoint + secret and updating
    client state directly instead of reloading.
- [x] **Verified live end-to-end**, no mocks: started a local HTTP
      receiver, added it as a real endpoint through the actual UI, hit
      "Test" and confirmed the receiver got a correctly-shaped payload
      with the right headers; **independently recomputed the HMAC
      signature in Python from the secret shown in the UI and confirmed
      it matched byte-for-byte** — the signing/verification contract is
      real, not just internally self-consistent; completed two real
      responses through the actual API and confirmed both were
      delivered automatically and logged `succeeded` in the UI;
      pointed the endpoint at a genuinely unreachable port, completed a
      response, and confirmed the delivery was recorded `failed` with
      `next_attempt_at` scheduled ~1 minute out (real backoff, not a
      guess); confirmed `POST /api/cron/webhooks/dispatch` returns 401
      with no/wrong bearer token and 200 with the right one; forced the
      retry due and confirmed the cron endpoint picked it up and
      incremented `attempt_count` to 2, still bounded, not exhausted.
- [x] 103/103 unit tests + 5/5 integration tests, lint, typecheck, and
      `next build` all green.
- [x] **Analytics** (`src/domains/analytics`, `src/lib/analytics`):
  - `events.ts` — `recordAnalyticsEvent`/`listAnalyticsEventsForForm`,
    a thin query-layer pair (no `"server-only"`, unlike most of this
    domain's siblings) so integration tests can call it directly with
    a service-role client, same as the response-engine tests do.
  - `posthog-server.ts` — a `"server-only"` best-effort wrapper around
    `posthog-node` (`flushAt: 1`/`flushInterval: 0` so a single event
    actually sends before the serverless function exits); a missing
    `POSTHOG_SERVER_API_KEY` makes it a silent no-op rather than an
    error, same pattern as Resend's `no_api_key` branch in
    `notifications/send.ts`.
  - Three call sites, chosen so the funnel counts respondent-server
    truth, never client JS that could be blocked or never run:
    `form_viewed` fires from `/f/[slug]`'s server component on every
    render (including a resumed session's refresh — a view is a view);
    `form_started` fires from `/api/responses/start`, which only ever
    runs once per response row (a resumed session skips `/start`
    entirely — see `PublicFormRuntime` — so this is exactly the "valid
    start" `computeCompletionRate` expects, never inflated by
    refreshes); `form_submitted` fires from
    `/api/responses/[id]/complete` alongside the existing notification/
    webhook `after()` work. The Postgres write (source of truth for
    the dashboard) and the PostHog capture (best-effort, for open-
    ended exploration) are separate calls at each site, and a failure
    in the Postgres write is caught locally so it can never block the
    notification/webhook side effects that run after it in the same
    `after()` callback.
  - Dashboard: `/forms/[id]/responses` now computes
    `computeFunnelSummary` server-side from `listAnalyticsEventsForForm`
    and renders a 4-card Views/Starts/Completions/Completion-rate row
    above the response table.
- [x] **Verified live**: seeded a real published form directly in
      local Postgres, hit the actual `GET /f/[slug]`,
      `POST /api/responses/start`, and `POST /api/responses/:id/
      complete` endpoints, and confirmed all three `analytics_events`
      rows landed with the right `event_type`/`session_id`/`metadata`;
      confirmed the isPreview-tag-and-exclude behavior already proven
      in unit tests also holds through a real DB round-trip (integration
      test); logged into the actual dashboard in a real browser and
      confirmed the funnel card rendered Views 1 / Starts 1 /
      Completions 1 / Completion rate 100% — matching the seeded events
      exactly, not a hardcoded or stale number.

## Deliberately deferred (not started)

- **Google Sheets integration** — the OAuth flow, token storage
  (`sheets_connections`), and per-response row sync
  (`sheets_sync_log`) are unimplemented. The spec allows shipping
  webhooks as the sole launch integration when Sheets has a genuine
  provider-qualification blocker; here it's more that OAuth
  app registration/verification with Google is an external, non-code
  dependency this environment can't complete, and building the token
  page plumbing against credentials that don't exist yet would mean
  shipping unverified, untestable code. Webhooks are complete and
  verified; Sheets is the explicitly-tracked gap, not a silently
  dropped requirement.

## In progress / next actions (in order)

1. ~20-30 templates + template picker (`templates` table already
   exists, unused so far).
2. Google Sheets integration, to the extent possible without live
   Google Cloud credentials — at minimum the domain-layer token
   storage/refresh logic and the per-response sync function, with the
   OAuth consent screen wiring documented as needing real credentials
   at deploy time (same pattern as the webhook cron secret).
3. Abuse/rate-limiting polish (the in-memory limiter is single-instance
   only — fine for now, documented upgrade path to a shared store),
   accessibility pass, responsive polish for the public runtime and
   dashboard on mobile.
4. Security hardening + adversarial review pass (see spec's
   quality_gate list) — replay/duplicate-submit/stale-write behavior
   is already tested at the domain layer; this pass should specifically
   try to break the HTTP layer (forged response/upload ids across
   forms, oversized payloads, malformed answer shapes, XSS in
   free-text answers). Webhook SSRF: literal-hostname/private-range
   checks are now in place at both creation and dispatch time
   (`isDisallowedWebhookHost`), but DNS-rebinding-time protection
   (resolving and checking the actual IP immediately before each
   connection) is still open — worth revisiting in this pass.
5. E2E test suite (`docs/testing.md`), full validation run, final
   report.

## Known bugs

None currently open. One was caught and fixed before it shipped this
session (the webhook-secret-reload bug above).

## How to resume

1. Read `CLAUDE.md` → `ARCHITECTURE.md` → `DECISIONS.md`.
2. Check `git log --oneline -20`.
3. Start local Supabase if not running: `supabase start` (from the
   project root; requires Docker). `.env.local` already has the local
   keys — regenerate with `supabase status -o env` if it's ever
   restarted with a different project ref.
4. Run `npm run lint && npm run typecheck && npm run test && npm run
test:integration`.
5. Continue with the next unchecked action above — templates.
