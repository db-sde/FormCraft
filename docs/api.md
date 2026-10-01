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
if no published version exists or the form was unpublished.

`POST /api/responses/start`

- body: `{ formId, referrer?, utmSource?, utmMedium?, utmCampaign?,
utmTerm?, utmContent?, embedded? }`
- creates a `responses` row (`status=in_progress`) for the form's live
  version and returns `{ responseId, formVersionId }`. The browser calls
  it on the respondent's first interaction, not on page load.
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
- a form with "save unfinished answers" off stores nothing here.

`POST /api/responses/:id/complete`

- body: `{ clientRevision, lastQuestionId, answers, idempotencyKey (uuid),
trap? }`
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
  "answers": { "questionId": "value" }
}
```

Signed via `X-FormCraft-Signature: sha256=<hmac>` using the endpoint's
`signing_secret`. Retries with bounded exponential backoff; duplicate
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

## Scheduled jobs

All guarded by `Authorization: Bearer $CRON_SECRET` (`401` without it,
`503` if the secret isn't configured). GET (Vercel Cron) or POST.

- `/api/cron/webhooks/dispatch`, `/api/cron/sheets/dispatch` — every 5
  minutes: first create any job a failed post-submit callback missed
  (last 24 hours), then claim due jobs (`FOR UPDATE SKIP LOCKED` with a
  lease, so overlapping runs never send twice) and send them.
- `/api/cron/retention` — daily: deletes unfinished responses past
  their form's retention, purges forms deleted over 30 days ago
  (including their files), prunes rate-limit rows.
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
synchronous bound, rather than silently truncating.

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
