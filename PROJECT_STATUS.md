# Project Status

Last updated: 2026-09-30

## Current milestone

**FULL-APP AUDIT** (2026-09-30) — a walkthrough of every area (builder,
runtime, dashboard, responses, integrations, auth) as a creator and a
respondent, fixing what it found in verified, committed batches. The
larger finds:

- **Password reset never worked** — the emailed link's redirect wasn't
  allowed, `/reset-password` bounced signed-in users, and the browser
  Supabase client couldn't read its env (also breaking image upload).
  New `/auth/confirm` route + E2E test through the real email link.
- **Exports and funnel stats silently capped at 1000 rows** (PostgREST
  `max_rows`): CSV export now pages; funnel counts in the database.
- **Webhook SSRF gaps**: redirects followed, loopback allowed in
  production, bracketed IPv6 / IPv4-mapped addresses unchecked, no DNS
  check. All closed.
- `javascript:`/`data:` URLs accepted for ending redirects/theme images.
- Invalid drafts showed "retrying" forever; a thrown save killed
  autosave for the session. Now explained inline and retried properly.
- Respondent runtime: server-side answer validation, Other option,
  auto-advance, keyboard handling, Strict-Mode blank first load.
- Dashboard: real response counts, "Edited" time never updated on
  autosave (migration 13), rename/duplicate/delete, nav + breadcrumbs,
  timestamps in the viewer's timezone, double-click created two forms.
- Unique-slug exhaustion, welcome screen rules, error/404/loading
  pages, README rewritten from the create-next-app boilerplate.

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
    response using the _same_ `formatAnswerValue`/`questionColumnLabel`
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
- [x] **Responsive/mobile pass**: walked the dashboard, builder,
      responses, integrations, and templates pages at a real 375px
      mobile viewport in a browser (not just resized devtools — actual
      layout, actual clicks). Found and fixed two real bugs. First,
      `src/app/(dashboard)/layout.tsx`'s header ran the workspace name
      and user email together into unreadable, wrapped text at narrow
      widths (`min-w-0`/`shrink-0` weren't set, so neither the text nor
      the flex row could resolve how to lay out); fixed by hiding the
      workspace name below `sm` and the email below `md` (secondary
      chrome, not essential at a glance) while keeping the logo and
      "Log out" always present. Second,
      `src/components/builder/form-builder.tsx`'s top toolbar
      (Integrations/Responses/View live/Unpublish/Preview/Publish) had
      no overflow handling and visually overlapped the back button at
      mobile widths; fixed with `overflow-x-auto` + `[&>*]:shrink-0` on
      that group so it scrolls within its own bounds instead of
      breaking the header layout. The responses funnel/table,
      integrations panels, and templates gallery all already reflowed
      correctly with zero changes.
- [x] Confirmed both fixes live in the browser at 375px width, not
      just by reading the CSS.
- [x] **Security/adversarial review pass**, run live against the
      actual running app (curl + a real browser), following the spec's
      quality_gate checklist. All of the following held up under live
      testing: forged/cross-form ids (unknown response id, unknown form
      id, a SQL-injection-flavored `formId` string, an upload request
      against a question id that doesn't belong to that form) correctly
      404/400 with no leak; an oversized 300KB payload correctly 400s
      before ever reaching Zod (`MAX_BODY_BYTES`); malformed answer
      shapes (array/string instead of object, missing fields, invalid
      JSON) correctly 400 with no 500s; an XSS payload submitted as a
      free-text answer renders as inert text on the response detail
      page (confirmed live — no raw script tag reaches the DOM, no
      alert fires; React's default escaping holds, nothing in this
      codebase bypasses it with `dangerouslySetInnerHTML` for
      respondent-supplied text); CSV formula injection was already
      mitigated by `neutralizeFormulaInjection` (confirmed live via the
      real export endpoint); the cron routes correctly 401 with
      no/wrong bearer token; the rate limiter doesn't false-positive on
      a normal few-request burst.
- [x] **Found and fixed a real gap**: `saveResponseAnswers` and
      `completeResponse` (`src/domains/responses/queries.ts`) accepted
      and persisted any `question_id` key a client sent, never checking
      it against the form's actual schema — a forged key got written
      straight into the `answers` table tied to a real `response_id`.
      Not a cross-tenant leak (the dashboard/CSV export only ever look
      up known question ids, so garbage keys were invisible, just dead
      weight) but a real violation of CLAUDE.md rule 1 and an unbounded
      storage-abuse vector (up to 120 requests/10min times arbitrary
      distinct keys per request). Fixed with
      `filterAnswersToKnownQuestions`, applied before every write in
      both functions; verified live against the real running API,
      confirming via a direct Postgres query that only the legitimate
      answer landed. New regression test in
      `tests/integration/responses.test.ts` covers both call sites.
- [x] 119/119 unit tests + 20/20 integration tests, lint, typecheck,
      and `next build` all green.
- [x] **E2E tests** (`tests/e2e`, Playwright):
  - `helpers.ts` — creates real, already-confirmed users via the
    GoTrue admin API (never a hand-crafted `auth.users` row — a real
    bug hit earlier this session, see DECISIONS.md), and cleans up
    every workspace a test creates before deleting the user
    (`workspaces.owner_id` is `on delete restrict`, deliberately, so
    cleanup order matters).
  - `auth.spec.ts` — signup reaches the check-email step; login with
    valid/invalid credentials; logout.
  - `form-builder.spec.ts` — dashboard empty state creates a form;
    add/edit/delete a question with autosave confirmed via reload.
  - `publish-and-respond.spec.ts` — publish, then complete the form in
    a genuinely separate browser context (no shared cookies) acting as
    an anonymous respondent, then confirm it shows in the creator's
    response dashboard.
  - `partial-response-resume.spec.ts` — a mid-form reload resumes from
    the same in-progress answer.
  - `duplicate-submit.spec.ts` — retries the real `/complete` HTTP call
    with the same idempotency key and asserts no duplicate.
  - `templates.spec.ts` — using a template twice proves the template
    itself is a read-only reference (editing the first copy never
    shows up in the second).
  - 6 of the 14 documented journeys (`docs/testing.md`) have coverage;
    the rest (question validation/logic/endings config, theming,
    response-dashboard-as-its-own-spec, CSV export, notification
    email, webhook delivery, analytics) are an explicitly tracked gap,
    not a silent one.
  - **Found two more real bugs**, both on the very first run of a
    genuinely new kind of test this codebase didn't have before:
    - `forms.slug` was only unique per-workspace
      (`unique(workspace_id, slug)`), but the public runtime looks a
      form up by slug alone — two different workspaces each leaving a
      form titled "Untitled form" (the literal default every new form
      starts with) broke the public URL for both with a
      `PGRST116: "multiple rows returned"` 500. Fixed in migration
      `00000000000012_forms_slug_globally_unique.sql` (global
      uniqueness, normalizing pre-existing duplicates first) —
      `createFormWithDraft`'s existing duplicate-key retry logic
      handles the rest with no app-code change needed.
    - `updateSession` (`src/lib/supabase/middleware.ts`) redirected an
      authenticated visitor away from "auth pages" using
      `path.startsWith(prefix)`, so `/signup` as a prefix also matched
      `/signup/check-email` — a just-signed-up, already-session'd user
      (this local dev environment auto-confirms) got bounced straight
      to `/dashboard` and never saw the "check your email"
      instructions meant for them. Fixed by matching the four real
      auth-entry paths exactly instead of as prefixes.
  - New integration regression test for the slug fix
    (`tests/integration/public-form-access.test.ts`, cross-workspace
    collision + auto-suffix + no-PGRST116 assertions).
  - CI: `.github/workflows/ci.yml` gained a second job
    (`integration-and-e2e`) that installs the Supabase CLI, runs
    `supabase start` (applying every migration), maps its connection
    details into this app's actual env var names, then runs
    integration tests and the full E2E suite. Verified every piece of
    this locally (the CLI commands, the env-var mapping, the test
    runs themselves); the workflow file itself hasn't been observed
    running inside an actual GitHub Actions runner, since this
    environment has no way to trigger one.
  - Also fixed `npm run format:check` (Prettier), which every prior
    milestone this session had been silently failing — it's listed in
    CI's first job but nothing local had been running it. Reformatted
    the whole repo once; should stay clean going forward since it's
    now actually gating something.
- [x] 119/119 unit tests + 21/21 integration tests + 9/9 E2E tests
      (chromium), lint, typecheck, format check, and `next build` all
      green.

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
- **The builder's 3-pane editing UI is not mobile-optimized** —
  question list + center canvas + right settings panel is a genuinely
  desktop-oriented layout (same scope decision comparable tools like
  Google Forms' and Typeform's own builders make; only their
  _respondent-facing_ forms are mobile-first). It doesn't break or
  overlap at mobile width, it scrolls horizontally like a dense
  editing surface — a deliberate, documented scope line, not an
  oversight (see DECISIONS.md). Every page a mobile visitor actually
  needs — the public respondent runtime, and the dashboard/responses/
  integrations/templates pages a creator might check on a phone — is
  fully responsive and verified.
- **Webhook SSRF DNS-rebinding protection** — `isDisallowedWebhookHost`
  checks the literal hostname/IP in the URL at both creation and
  dispatch time, but doesn't resolve the hostname and check the actual
  IP immediately before each connection, so a hostname that resolves
  to a private address only at request time (DNS rebinding) isn't
  caught. Noted during this pass; not fixed here since it needs a real
  DNS-resolution step in the dispatch path, a more involved change
  than the rest of this pass's fixes — worth its own focused pass.

- **Remaining 8 of 14 documented E2E journeys** — question validation/
  logic/multiple-endings configuration, theming + preview, a dedicated
  response-dashboard spec (table/detail/delete), CSV export,
  notification email (local Supabase's Inbucket/Mailpit could back
  this), webhook delivery (against a local test receiver, same
  approach the webhooks milestone verified with manually), analytics
  numbers. Explicitly tracked in `docs/testing.md`'s per-journey
  status table, not silently dropped.
- **CI's new `integration-and-e2e` job hasn't run inside an actual
  GitHub Actions runner** — every individual piece (the Supabase CLI
  commands, the env-var override-name mapping, `npm run
test:integration`, the full E2E suite) was verified locally against
  the real local Supabase stack; this environment has no way to
  trigger an actual Actions run. Worth confirming on the first real PR.

## In progress / next actions (in order)

1. The remaining E2E journeys listed above, as time allows — not
   blocking, since the highest-risk flows (auth, builder CRUD,
   publish→respond, partial-response resume, duplicate-submit,
   templates) already have coverage.
2. Confirm the new CI job actually passes on a real GitHub Actions run
   the first time this branch/PR goes through it.

## Known bugs

None currently open. The 2026-09-30 audit's fixes are summarized under
"Current milestone" above (details in each commit message).
Not bugs, but known limits: WebKit/mobile-safari E2E needs
`npx playwright install webkit` locally; webhook DNS-rebinding
protection is deferred (see DECISIONS.md). Several were caught and fixed before/while
shipping this session (the webhook-secret-reload bug, the
signed-in-visitor-gets-404 RLS bug, the dashboard/builder mobile
header overflow bugs, the forged-question-id storage-abuse gap, the
cross-workspace forms.slug collision, and the auth-redirect middleware
prefix-match bug, all above).

## How to resume

1. Read `CLAUDE.md` → `ARCHITECTURE.md` → `DECISIONS.md`.
2. Check `git log --oneline -20`.
3. Start local Supabase if not running: `supabase start` (from the
   project root; requires Docker). `.env.local` already has the local
   keys — regenerate with `supabase status -o env` if it's ever
   restarted with a different project ref.
4. Run `npm run lint && npm run typecheck && npm run format:check &&
npm run test && npm run test:integration`. If the `templates` table
   looks empty locally, run `npm run db:seed-templates` (idempotent —
   safe to re-run). For E2E: `npx playwright install chromium` once,
   then `npm run e2e`.
5. Continue with the next unchecked action above — the remaining E2E
   journeys, then confirm the new CI job on a real PR.
