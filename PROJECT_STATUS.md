# Project Status

Last updated: 2026-09-28

## Current milestone

**ABUSE/RATE-LIMITING + ACCESSIBILITY** — login/signup/forgot-password
are now rate-limited (previously only the public response endpoints
were); the public runtime got a real WCAG fix (focus wasn't moving
between consecutive same-type questions — see below) plus proper
`role="alert"`/`role="progressbar"` semantics. Also fixed, found while
live-testing this milestone: a real RLS bug where any *signed-in*
visitor got a false 404 on every public form link (migration
00000000000011, its own commit). Responsive/mobile polish for the
dashboard is next, then the security/adversarial review pass, then
E2E tests.

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
- [x] 103/103 unit tests + 11/11 integration tests, lint, typecheck,
      and `next build` all green.
- [x] **Templates** (`src/domains/templates`, `scripts/seed-templates.ts`):
  - `queries.ts` — `listTemplates` (id/title/category/description for
    the gallery) and `getTemplateById` (includes the schema, re-parsed
    through `parseFormSchema` on read so a hand-edited DB row can never
    hand the builder something invalid).
  - `scripts/seed-templates.ts` (`npm run db:seed-templates`) builds 24
    templates across 8 categories (Feedback, Surveys, Lead Generation,
    HR & Recruiting, Events, Education, E-commerce, Marketing) using
    the same `createQuestion`/`createOption`/`createEnding` helpers the
    builder UI itself uses, then runs every one through the real
    `parseFormSchema`/`validateSemantics` pipeline before writing —
    a template that failed validation would fail here, not silently
    ship. Idempotent (upserts by title), so it's safe to re-run after
    editing a template.
  - `createFormWithDraft` (`src/domains/forms/queries.ts`) now takes an
    optional `initialSchema`, so a template-created form reuses the
    exact same slug-allocation/insert logic as a blank one — a
    template is just a form whose first draft didn't start blank.
  - UI: `/templates` — a gallery grouped by category, "Use this
    template" per card (a bound server action, `createFormFromTemplateAction`),
    plus "Start from scratch" at the top. Linked from the dashboard's
    header and its empty state (which already said "pick a template"
    with nothing behind it before this).
- [x] **Verified live**: ran the seed script against local Postgres —
      all 24 schemas passed real validation and were inserted; loaded
      `/templates` in a real logged-in browser session and saw all 24
      cards grouped into their 8 categories; clicked "Use this
      template" on the CSAT template and confirmed it redirected into
      the actual builder at `/forms/[id]` with the form titled
      "Customer Satisfaction Survey (CSAT)" and all 4 of its questions
      (welcome + 3) plus its ending present — not the blank 2-question
      starter a normal "New form" produces.
- [x] 119/119 unit tests + 16/16 integration tests, lint, typecheck,
      and `next build` all green.
- [x] **Google Sheets** (`src/domains/sheets`):
  - `crypto.ts` — AES-256-GCM encrypt/decrypt for tokens at rest
    (`sheets_connections.encrypted_tokens`), key derived from
    `APP_SECRET`, fresh random IV + auth tag per encryption so
    tampering with a stored row is detected on decrypt.
  - `oauth.ts` — `buildAuthorizeUrl`/`exchangeCodeForTokens`/
    `refreshAccessToken` against Google's real endpoints (both take an
    optional endpoint override, specifically so they can be exercised
    against a fake local server — see "Verified live" below).
    `isGoogleOAuthConfigured()` lets routes/UI degrade to a clear
    "not configured" state instead of a broken redirect when
    `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET`/`_REDIRECT_URI` aren't set.
  - `row.ts`/`append.ts` — builds one Sheets row per completed
    response using the *same* `formatAnswerValue`/`questionColumnLabel`
    CSV export already uses (a form's Sheet and its CSV export can
    never disagree about columns), then POSTs it via
    `values.append` (`apiBase` overridable, same reason as above).
  - `queries.ts` — connection CRUD (`saveConnection` upserts by
    `form_id`, which is unique on the table, so reconnecting replaces
    rather than duplicates) and `enqueueSheetsSync`/
    `dispatchDueSheetsSyncs`, which deliberately reuse
    `@/domains/webhooks/backoff`'s bounded schedule rather than
    duplicating it — same shape as the webhooks retry sweep, down to
    the `pending`/`failed`/`exhausted` status lifecycle.
  - Routes: `/api/integrations/google/authorize` and `/callback`
    (session-authenticated, re-verify workspace ownership of the form
    id carried in OAuth `state` since `state` is attacker-visible —
    see the route's own comment) and `POST /api/cron/sheets/dispatch`
    (`CRON_SECRET`-gated, same pattern as the webhooks cron route).
    The first sync attempt is immediate via `after()` in
    `/api/responses/[id]/complete`, wrapped in its own try/catch so a
    Sheets failure can never affect the notification/webhook work
    that already succeeded before it.
  - UI: the Sheets section on `/forms/[id]/integrations` — a "not
    configured" alert when the server has no OAuth client, "Connect
    Google Sheets" otherwise, then a spreadsheet-id field, an
    enable/disable toggle, disconnect, and a sync log.
- [x] **Verified live, to the actual limit of what's possible without
      a real Google Cloud project**: a tiny local HTTP server stood in
      for Google's token + Sheets API endpoints (`dispatchDueSheetsSyncs`
      takes their base URLs as options for exactly this); ran a genuine
      end-to-end cycle — an expired stored access token triggered a
      real refresh call, the refreshed token was persisted back
      encrypted, and the response's actual answer ("Ada Lovelace")
      arrived in the fake server's received row; also verified a
      failure is recorded `failed` with `next_attempt_at` scheduled
      forward (bounded backoff, not exhausted on one miss) and that
      stored tokens never contain the raw secret in plaintext.
      Separately, with placeholder `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET`
      set, clicked "Connect Google Sheets" in a real browser and
      confirmed it reached the **real** `accounts.google.com` consent
      endpoint with the correct scope/state/`access_type=offline`/
      `prompt=consent` params — Google itself returned
      `Error 401: invalid_client`, which is exactly the expected
      boundary (no real client is registered) and confirms the entire
      flow is correct right up to that boundary.
- [x] **Fixed a real bug found via live testing**: signed-in visitors
      got a false 404 on every public form link — the RLS policies
      backing `/f/[slug]` were scoped `to anon` only, so a logged-in
      session (running as the `authenticated` Postgres role) matched no
      SELECT policy at all. Migration
      `00000000000011_public_form_read_for_authenticated.sql` fixes it;
      `tests/integration/public-form-access.test.ts` is a new
      RLS-respecting test (signs in as a real user via the anon-key
      client, not the service-role client every other integration test
      uses) that closes the coverage gap that let this ship — see
      DECISIONS.md.
- [x] **Rate limiting extended to auth** (`src/app/(auth)/actions.ts`):
      login (10/10min, keyed IP+email so one shared IP can't lock out
      every account behind it), signup (10/hour/IP), forgot-password
      (5/hour/IP, silently no-ops into the same "check your email"
      redirect when limited — a different response shape here would
      leak account-enumeration signal). `src/lib/http/client-ip.ts`
      adds the Server Action equivalent of the route handlers'
      `getClientIp`. Verified live: scripted 12 submissions against a
      running production build through the real login form and
      `document.body.innerText` correctly ~flipped from "Incorrect
      email or password" to "Too many attempts..." exactly once the
      10-attempt threshold was crossed.
- [x] **Runtime accessibility fixes** (`src/components/runtime/form-runtime.tsx`):
      found and fixed a real bug where `RuntimeQuestionInput` had no
      `key={question.id}`, so React reused the same DOM `<input>` across
      two consecutive same-type questions (e.g. "First name" →
      "Last name") — `autoFocus` never refired and focus never moved,
      a real WCAG 2.4.3 (Focus Order) failure, not just a nice-to-have.
      Also added `role="alert"` on the validation error message (was
      silent to screen readers) and `role="progressbar"` +
      `aria-valuenow`/`min`/`max`/label on the progress bar (was a
      purely decorative div). Verified live: seeded a form with two
      consecutive `short_text` questions, advanced past the first via
      Enter, and confirmed `document.activeElement` was the fresh
      `<input>` for "Last name", not the previous one.
- [x] 119/119 unit tests + 19/19 integration tests, lint, typecheck,
      and `next build` all green.

## Deliberately deferred (not started)

- **Registering a real Google Cloud OAuth client** — everything on the
  code side of Google Sheets is implemented and verified (see above):
  encrypted token storage/refresh, the sync/backoff/retry engine, the
  connect/disconnect UI, and both OAuth routes, verified against a
  real local fake-Google server plus one live hit against Google's
  actual consent endpoint. The one remaining piece is registering an
  actual OAuth client in a Google Cloud project (client id/secret,
  configuring the consent screen, requesting the `spreadsheets` scope,
  and — for a client used by real users rather than just this
  workspace's owner — Google's app verification review), which is an
  external, non-code action outside this environment. At deploy time:
  create the OAuth client, set `GOOGLE_OAUTH_CLIENT_ID`/
  `GOOGLE_OAUTH_CLIENT_SECRET`/`GOOGLE_OAUTH_REDIRECT_URI` (see
  `.env.example`), and the feature is live with no code changes.

## In progress / next actions (in order)

1. Responsive/mobile polish for the dashboard specifically (the public
   runtime has been checked at mobile width — see above; the
   dashboard/builder/responses UI hasn't been walked at mobile width
   yet this pass).
2. Security hardening + adversarial review pass (see spec's
   quality_gate list) — replay/duplicate-submit/stale-write behavior
   is already tested at the domain layer; this pass should specifically
   try to break the HTTP layer (forged response/upload ids across
   forms, oversized payloads, malformed answer shapes, XSS in
   free-text answers). Webhook SSRF: literal-hostname/private-range
   checks are now in place at both creation and dispatch time
   (`isDisallowedWebhookHost`), but DNS-rebinding-time protection
   (resolving and checking the actual IP immediately before each
   connection) is still open — worth revisiting in this pass.
3. E2E test suite (`docs/testing.md`), full validation run, final
   report.

## Known bugs

None currently open. Several were caught and fixed before/while
shipping this session (the webhook-secret-reload bug and the
signed-in-visitor-gets-404 RLS bug, both above).

## How to resume

1. Read `CLAUDE.md` → `ARCHITECTURE.md` → `DECISIONS.md`.
2. Check `git log --oneline -20`.
3. Start local Supabase if not running: `supabase start` (from the
   project root; requires Docker). `.env.local` already has the local
   keys — regenerate with `supabase status -o env` if it's ever
   restarted with a different project ref.
4. Run `npm run lint && npm run typecheck && npm run test && npm run
test:integration`. If the `templates` table looks empty locally, run
`npm run db:seed-templates` (idempotent — safe to re-run).
5. Continue with the next unchecked action above — dashboard mobile
   polish, then the security/adversarial review pass, then E2E tests.
