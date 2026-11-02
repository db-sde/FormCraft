# API

Two audiences: the authenticated creator app (mostly server actions
called from the dashboard/builder) and the public respondent runtime
(route handlers under `src/app/api/*`, no auth). This doc covers the
public/route-handler surface, since that's what has a real HTTP
contract; server actions are internal and typed end-to-end already.

All responses use a consistent error shape:

```json
{ "error": { "code": "string_machine_code", "message": "human readable" } }
```

## Public runtime

`GET /f/:slug` — page. Server-resolves the published `form_versions`
row for the workspace's form with that slug; 404 (rendered, not raw)
if no published version exists or the form was unpublished. A
password-protected form renders only its title, theme and a password
field until unlocked; a closed or full form renders the creator's
message instead of the form.
`?resume=<token>` (P2.8) opens that unfinished response — same row,
answers, position and seed — when the link is valid; otherwise the
page starts fresh with a note (expired, already submitted, form
changed, turned off). The browser removes the token from the address
bar straight away.

`POST /api/responses/start`

- body: `{ formId, referrer?, utmSource?, utmMedium?, utmCampaign?,
utmTerm?, utmContent?, embedded?, hidden?, seed? }` — `hidden`: the
  form's URL fields (undeclared names dropped); `seed`
  (`^[A-Za-z0-9_-]{8,64}$`, ignored otherwise): the browser's random
  seed, stored on the response so the server asks the same pool
  questions the respondent saw.
- creates a `responses` row (`status=in_progress`) for the form's live
  version and returns `{ responseId, formVersionId }`. The browser calls
  it on the respondent's first interaction, not on page load.
- `403 locked` when the form has a password and the request carries no
  valid unlock cookie (see `POST /api/responses/unlock`).
- `410 form_closed` with `{ error: { reason: "closed" | "full", message } }`
  once the form is past its close date or response cap; `message` is
  the creator's text (or the default).
- rate-limited to 120 per 10 minutes per address + form (generous on
  purpose: a school or office shares one address). The address is not
  taken from the visitor-controlled start of `X-Forwarded-For` — see
  "Client address" below.

`PATCH /api/responses/:id/answers`

- body: `{ clientRevision: number, lastQuestionId: string,
answers: Record<questionId, value> }`
- one database call (`save_response_progress`) writes the answers and the
  revision together or not at all. Answers for questions the form
  doesn't have are dropped; empty answers (`""`, `[]`, `{}`, `null`)
  delete the stored one instead of saving a blank. Advances `status`
  to `partial` on the first saved answer; updates `last_active_at`.
- `409 conflict` with `{ error: { currentRevision } }` when
  `clientRevision <= responses.client_revision` — a stale tab or a
  delayed retry. The client resyncs to `currentRevision`.
- `409 already_submitted` once the response is completed.
- `410 form_closed` (as for start) once the form closed or filled up:
  nothing more is saved.
- a form with "save unfinished answers" off stores nothing here.

`POST /api/responses/:id/complete`

- body: `{ clientRevision, lastQuestionId, answers, idempotencyKey (uuid),
trap?, captchaToken? }`
- before anything else, for a response that isn't completed yet:
  `403 locked` if the form has a password and the unlock cookie is
  missing, expired or from an earlier password; and, on a form that
  requires a CAPTCHA, the Turnstile token is verified with Cloudflare —
  once per response: a pass is stored (`responses.captcha_verified_at`),
  so resubmitting after fixing an answer needs no new token. It fails
  closed:
  `400 captcha_failed` (no token, or Cloudflare refused it) or
  `503 captcha_unavailable` (no secret key configured, or Cloudflare
  unreachable). Failures are logged as `captcha_failed` with the reason,
  never the token or answers.
- `410 form_closed` with `{ error: { reason, message } }` past the close
  date or response cap. The database decides this inside
  `complete_response_atomic`, in the same transaction as the write, so
  it holds for a page opened before the deadline and for submits racing
  for the last place. A retry of a submit that already succeeded still
  returns its original result.
- validates first, writes second: required-and-reachable questions are
  checked server-side with the same logic engine as preview, and file
  answers must be real, clean uploads of this response and question. A
  rejected submission leaves nothing behind. On success the answers,
  the ending (computed server-side, never trusted from the client) and
  `status=completed` are written in one call (`complete_response_atomic`).
- idempotent: a retried submit returns the original result
  (`alreadyCompleted: true`) rather than erroring or completing twice.
- `trap` is the hidden spam-trap field. A filled trap **flags** the
  response (`spam_suspected`) and suppresses notifications, webhooks
  and Sheets rows for it; the response itself is kept, because browser
  autofill sometimes fills hidden fields and a real person must never
  lose a submission to that.
- after the response is sent, independent steps run (analytics,
  notification, webhook enqueue + dispatch, Sheets enqueue + dispatch);
  one failing never affects another or the respondent's 200.

`POST /api/responses/unlock` (master spec F-48)

- body: `{ formId, password }`. Checks the password against the form's
  scrypt hash and sets `fc_unlock_<formId>`: httpOnly, 12 hours, path
  `/`, `SameSite=None; Secure; Partitioned` over HTTPS (so it works in
  embeds), `Lax` over plain HTTP. Its value is an expiry plus an HMAC
  (`APP_SECRET`) over the form id, the expiry and the current hash, so
  changing or removing the password invalidates every earlier cookie.
- `401 wrong_password`; `200` also when the form has no password (the
  answer doesn't reveal which forms have one).
- rate-limited to 10 per 10 minutes per address + form.

`POST /api/responses/kiosk-exit` (master spec F-15)

- body: `{ formId, pin }`. `200` when the PIN matches the form's kiosk
  PIN (or none is set), `401 wrong_pin` otherwise. Rate-limited to 10
  per 10 minutes per address + form. Leaving kiosk mode happens in the
  browser; this only checks the PIN.
- `POST /api/responses/start` also takes `kiosk: true`: the response
  isn't tied to the device's visitor id.

`POST /api/responses/:id/resume-link` (P2.8)

- no body. Returns `{ path, expiresAt }` — `/f/:slug?resume=<token>`,
  valid 30 days. `409 unavailable` when the form has resume links off,
  the response is submitted, or it doesn't exist. The token is 256
  random bits; only its SHA-256 is stored. Completing the response
  revokes its links. 20 per hour per address.

`POST /api/responses/:id/follow-up` (P3.7)

- `{ questionId, answer }` → `{ question }`: one AI-written follow-up
  about a long-text answer, or `null`. Only for questions with
  `aiFollowUp` in the version the response was served; at most 3 per
  response; asking again returns the same question. Never an error to
  the respondent: no key, no credits, a slow or refused model and rate
  limits (10 an hour per address and response) all mean `null`.
- `PUT` `{ questionId, reply }` → `204`. Saves the reply to a follow-up
  that was asked (`404` otherwise). Editable until the response is
  submitted.

`POST /api/responses/:id/lookup` (logic phase 24)

- `{ questionId, answers }` → `{ values }`: runs the form's data lookups
  triggered by that question and returns the URL fields they filled
  (also stored on the response, which is what the server's walk reads at
  submission). Empty when there are none, the API failed, the response
  is submitted or doesn't exist, the plan doesn't include lookups, or a
  limit was hit (20 an hour per address and response; 10 calls per
  response) — never an error the form has to handle.
- The request the server makes is fixed by the creator's saved lookup:
  GET, HTTPS to a public address, no redirects, 4 seconds, 64 KB of
  JSON. Answers are inserted percent-encoded into the path or query and
  cannot change the host.

`POST /api/responses/:id/uploads/:questionId`

- multipart. Rejected with `411` without a `Content-Length`, `413` when
  the declared size is over the question's limit (before the body is
  read), `409 already_submitted` after completion. The content type is
  sniffed from the bytes, not trusted from the browser. Stored in a
  private bucket; a new upload for the same question replaces the old
  one. Returns `{ uploadId }` — the answer value, never a public URL.

`POST /api/responses/events`

- body: `{ formId, type: "question_viewed" | "question_answered",
questionId }` — ids only, never answer values. Accepted only for a
  live form and a question that exists in it; `204`, recorded after the
  response is sent. Rate-limited per address + form.

## Webhooks (creator-configured, outbound)

Endpoints have a `kind`: `webhook` (signed JSON, below), `slack` (a
Slack incoming-webhook URL — only `https://hooks.slack.com/…`; the body
is a Slack message with the form title, the chosen answers and a link to
the response; file answers are never linked), `zapier` / `make` (made
through the API). All share the delivery queue and retry schedule.

`POST /api/webhooks/test` — send a synthetic test payload to a
configured endpoint (auth required, workspace-scoped).

Delivery payload:

```json
{
  "eventId": "uuid",
  "eventType": "response.completed",
  "formId": "...",
  "responseId": "...",
  "submittedAt": "ISO-8601",
  "endingId": "...",
  "answers": { "questionId": "value" },
  "variables": { "score": 72, "segment": "enterprise" },
  "hidden": { "source": "linkedin" }
}
```

`variables` are the form's computed results (scores, totals, segments)
by variable name, recomputed by the logic engine from the response's own
form version with the clock pinned to `submittedAt`. `hidden` holds the
values of the form's declared hidden fields from the respondent's link —
respondent-controlled, so don't trust them for anything sensitive.

Signed with the endpoint's own secret (shown once when the endpoint is
added; Integrations → ↻ makes a new one, and the old one stops working):

    X-FormCraft-Timestamp: 1793031457
    X-FormCraft-Signature: t=1793031457,v1=<hex HMAC-SHA256 of "1793031457.<raw body>">

Receivers should recompute the HMAC over the timestamp, a dot and the
exact body bytes, compare in constant time, and reject a timestamp more
than five minutes away from their clock (replays). Reference:
`verifySignature` in `src/domains/webhooks/signing.ts`. Retries with bounded exponential backoff; duplicate
deliveries are possible by design — consumers must dedupe on
`eventId`. This is documented for creators in-product, not just here.

## Integrations (inbound, OAuth)

`GET /api/integrations/google/authorize?formId=` — begins OAuth (auth
required, form must be the caller's). Sets a short-lived `httpOnly`
cookie and sends a signed `state` bound to the user, the form and that
cookie, so a link crafted by someone else can't attach their Google
account to your form.
`GET /api/integrations/google/callback` — verifies `state` (`400
invalid_state` otherwise), exchanges the code, stores tokens, never
returns them to the client. Disconnecting is a server action in the
form's Integrations tab.

## Payments (Stripe, P2.17)

- `POST /api/responses/:id/complete` returns `paymentUrl` (a Stripe
  Checkout URL) when the form takes payment; the amount is computed on
  the server. The runtime sends the respondent there; answers are
  already saved.
- `GET /f/:slug/payment?session_id=…` — the return page. It asks Stripe
  (server-side) and shows paid / processing / "try again".
- `POST /api/payments/stripe/:workspaceId` — the workspace's Stripe
  webhook endpoint. Accepted only with a valid `Stripe-Signature` for
  that workspace's signing secret (five-minute tolerance). Handles
  `checkout.session.completed` / `async_payment_succeeded` / `_failed` /
  `expired`; a paid payment never goes back.

## Public API v1 (Zapier / Make)

`Authorization: Bearer fc_live_…` — a workspace API key (Settings → API,
Business plan; shown once, stored as SHA-256). 120 requests a minute per
key. Every call re-checks the plan; revoking a key removes its hooks.

**Scopes (P3.11).** Each key has one or more of `forms:read`,
`responses:read`, `hooks:write`, chosen when it's created. Keys made
before scopes existed have all three. A call outside the key's scopes
gets `403 forbidden`.

- `GET /api/v1/me` → `{ workspace: { id, name } }` (connection test; any
  scope).
- `GET /api/v1/forms` (`forms:read`) → `{ forms: [{ id, title }] }` —
  live forms only.
- `GET /api/v1/forms/:id` (`forms:read`) → the form with its live
  version's schema (`published.schema`), or `published: null`.
- `GET /api/v1/forms/:id/responses` (`responses:read`) →
  `{ data, next_cursor }`: completed (non-spam) responses, newest first,
  in the webhook payload shape. `?limit=1..100` (default 25);
  `?cursor=` is the previous page's `next_cursor`, which is `null` on the
  last page. Zapier's sample uses `?limit=3`.
- `GET /api/v1/responses/:id` (`responses:read`) → one completed
  response in the same shape; `404` for another workspace's.
- `POST /api/v1/hooks` `{ formId, url, source: "zapier" | "make" }` →
  `201 { id }`. Subscribes to "new completed response": an ordinary
  signed webhook endpoint (same queue, retries, HTTPS + public-address
  checks). `404` for another workspace's form, `400` for a private or
  non-HTTPS URL.
- `DELETE /api/v1/hooks/:id` → `204`; only the key's workspace's hooks.
  Both hook calls need `hooks:write`.

**Errors.** Every error is `{ "error": { "code", "message" } }` with the
matching status: `unauthorized` 401, `forbidden` 403 (missing scope),
`not_found` 404 (including another workspace's ids — existence isn't
revealed), `invalid_body` / `invalid_query` / `invalid_url` 400,
`rate_limited` 429, `unknown` 500. `message` is for people; branch on
`code`.

**Versioning.** The version is in the path (`/api/v1`). Within v1,
changes are additive only: new endpoints, new optional parameters, new
fields in responses (clients must ignore fields they don't know) and new
error codes for new situations. Removing or renaming a field, changing
a type or a default, or tightening validation means `/api/v2`, with v1
kept running for at least 12 months after v2 ships. The one break so far
happened before any public listing: `GET /forms/:id/responses` went from
a bare array to `{ data, next_cursor }` when pagination was added.

## SCIM 2.0 (P3.18)

Base URL `/api/scim/v2`, `Authorization: Bearer scim_…` (one token per
workspace, made in Settings → Security, Enterprise plan; shown once,
stored as SHA-256). 300 requests a minute. Bodies and replies are
`application/scim+json`; errors use the SCIM error schema
(`{ schemas, status, detail, scimType? }`).

- `GET /ServiceProviderConfig`, `/ResourceTypes`, `/Schemas` — discovery.
  Patch and filter are supported; bulk, sort, ETags and password change
  are not. Only the User resource exists.
- `GET /Users` — `?filter=userName eq "a@b.co"` (the only filter),
  `startIndex` (1-based), `count` (max 100).
- `POST /Users` → `201`. `userName` must be an email (else the primary
  entry of `emails`); `displayName` / `name`, `externalId`, `active` are
  kept, other attributes ignored. `409 uniqueness` if already listed.
- `GET` / `PUT` / `PATCH` / `DELETE /Users/:id`. PATCH takes `add` and
  `replace` by path or as a value object (what Okta and Entra send).

A listed user is someone who _may_ join: Supabase never links an SSO
sign-in to an existing account, so accounts aren't created here.
They become a member, with the workspace's default SSO role, the first
time they sign in through SSO. Setting `active: false` or deleting them
removes their membership immediately (never the owner's) and stops them
rejoining. While a token exists, only listed, active people can join
through SSO.

## A/B tests (P3.9)

No endpoint of their own. When a form's link has a running test, the
public page picks the arm from the `fc_vid` visitor cookie (set by the
proxy) and passes `experimentId` to `POST /api/responses/start`, which
only records it if the test is running and the form is one of its arms.

## Scheduled jobs

All guarded by `Authorization: Bearer $CRON_SECRET` (`401` without it,
`503` if the secret isn't configured). GET (Vercel Cron) or POST.

- `/api/cron/webhooks/dispatch`, `/api/cron/sheets/dispatch` — every 5
  minutes: first create any job a failed post-submit callback missed
  (last 24 hours), then claim due jobs (`FOR UPDATE SKIP LOCKED` with a
  lease, so overlapping runs never send twice) and send them.
- `/api/cron/retention` — daily: deletes unfinished responses past
  their form's retention, completed responses past their workspace's
  retention (P3.16, logged in the audit log), purges forms deleted over
  30 days ago (including their files), prunes rate-limit rows.
- `/api/cron/health` — read-only report for an uptime monitor: retries
  overdue by more than 15 minutes (the sweeps stopped), jobs that gave
  up in the last day, uploads stuck pending. `200` when healthy, `503`
  with `problems` when not. Not scheduled in `vercel.json` — point an
  external monitor at it.

## Client address

Per-IP limits need the visitor's address, and the first
`X-Forwarded-For` entry is whatever the visitor wrote. `src/lib/http/ip.ts`
uses, in order: the header named by `CLIENT_IP_HEADER` (one your host
sets itself, e.g. `x-vercel-forwarded-for`, `cf-connecting-ip`); else the
`X-Forwarded-For` entry `TRUSTED_PROXY_HOPS` from the right (default 1);
else `X-Real-IP`; else `"unknown"`. Values that aren't an IP address are
treated as `"unknown"`.

## Exports

`GET /api/forms/:id/export.csv` — auth + workspace check. Bounded
(documented row limit in `docs/testing.md`/product copy); returns a
clear `400` with guidance if the response count exceeds the safe
synchronous bound, rather than silently truncating. Takes the
responses page's filters (`view`, `period`, `ending`, `q` + `a`,
`search`), so it holds exactly what the table shows.

`GET /api/leads/export.csv` — the workspace's leads (`?form=` for one
form's).

Both accept `?format=xlsx` for the same table as an Excel workbook
(`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`).
CSV downloads start with a UTF-8 byte-order mark so Excel reads
non-ASCII text correctly.

## Records view and import (server actions)

No new HTTP routes. Server actions, each authenticating and checking the
workspace role and permission first:

- `setReviewStatusAction`, `setAssigneeAction`, `addCommentAction` —
  editors and up with `view_responses`, for a response of that form in
  their workspace.
- `replayAttemptAction` — also needs `manage_integrations`; failed or
  given-up webhook and Sheets attempts only.
- `importFormAction` — editors and up; 20 imports an hour per person.
- `dismissImportReportAction` — editors and up.

The uploads route (`POST /api/responses/:id/uploads/:questionId`) also
takes signature questions: `image/png` only, 512 KB at most.

## Documents and embeds (Phase 3)

- `GET /api/forms/:id/responses/:responseId/documents/:kind` — the PDF
  (`summary`, `order`, `registration`, `certificate`), for members with
  `view_responses`; 404 when the response doesn't qualify.
- `GET /api/embed/sdk.js` — the embed SDK (public, cacheable).
- `POST /api/embed/events` — `{ slug, event: "impression" | "open",
mode, trigger, pageview }` as a text body; always 204; deduped per
  page view.
- `GET|POST /api/cron/digests` — daily digests (CRON_SECRET).

## Phase 4

- `GET /api/forms/:id/crosstab.csv?x=&y=` — the cross-tab of two
  questions, with the responses page's filters (`period`, `ending`,
  `q` + `a`, `search`, `source`); needs `export_responses`.
- `source` is accepted by `export.csv` too.
- Confidential forms: `export.csv`, `crosstab.csv` and the public API's
  response endpoints answer 403 (`confidential`).
- Server action `proposeFormEditAction` (Edit with AI) and the variant /
  confidential settings actions in Settings.

## Phase 5

- `GET /api/bookings/slots?response=&question=&from=&days=` — free start
  times for a booking question of an unfinished response (public, rate
  limited).
- `POST /api/bookings/manage` — `{ token, action: "slots" | "cancel" |
"reschedule", from?, start? }` from the attendee's link.
- `GET /api/connectors/:provider/authorize?returnTo=` → provider;
  `GET /api/connectors/oauth/callback` ← provider.
- `GET|POST /api/cron/connectors` — connector jobs, reminders, calendar
  sync (CRON_SECRET).
- Page `/booking/:token` — the attendee's booking.

## Phase 6

- No new route handlers. `GET /api/connectors/:provider/authorize` also
  takes `airtable`, `salesforce`, `notion`, `mailchimp`, `zoho_crm` and
  `pipedrive` (workspace connections: admins, or members with "Manage
  integrations").
- Server actions on Integrations (`connector-actions.ts`):
  `connectorChoicesAction` (bases, tables, databases, audiences),
  `connectorFieldsAction` (destination fields, with unsupported ones),
  `saveConnectorLinkAction`, `deleteConnectorLinkAction`,
  `disconnectAppAction`.
- `GET|POST /api/cron/connectors` also queues syncs a killed request
  missed (`recovered` in its reply).

## Conventions

- Every mutating endpoint requires auth _except_ the public runtime
  trio (`start`/`answers`/`complete`) and `uploads`, which are instead
  protected by rate limiting + response-id possession (the id itself
  is an unguessable UUID, never enumerable) + form publication-state
  checks.
- Pagination: cursor-based (`?cursor=...&limit=...`), default/max
  limits enforced server-side, never a client-suppliable unbounded
  limit.
- IDs in URLs are opaque UUIDs; nothing sequential/enumerable is
  exposed for tenant-scoped resources.
