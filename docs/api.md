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

- body: `{ formId, isPreview?: boolean }`
- creates a `responses` row (`status=in_progress`), returns
  `{ responseId, formVersionId }`.
- rate-limited per IP+formId (bounded, cardinality-aware — see
  `src/domains/abuse`).

`PATCH /api/responses/:id/answers`

- body: `{ clientRevision: number, lastQuestionId: string,
answers: Record<questionId, value> }`
- upserts answers, advances `status` to `partial` on first successful
  write, updates `last_active_at`.
- rejects (`409 conflict`) if `clientRevision <= responses.client_revision`
  currently stored — protects against out-of-order/stale autosaves
  from a stale tab or a delayed retry.
- idempotent for the same `clientRevision` (safe to retry on network
  failure without double-processing).

`POST /api/responses/:id/complete`

- body: `{ idempotencyKey: string, endingId?: string }`
- validates all required-and-reachable questions are answered
  (server-side, using the same logic engine as preview).
- unique constraint on `idempotency_key` makes retried submits a
  no-op that returns the original result rather than erroring.
- transitions `status` to `completed`; trigger blocks any further
  status transition.
- fires `analytics_events(form_submitted)`, enqueues webhook/Sheets
  side effects, enqueues notification email. None of these being slow
  or failing affects the 200 response to the respondent.

`POST /api/uploads/:responseId/:questionId`

- multipart; server validates size, sniffs actual content type
  (not trusting the browser-supplied MIME), writes to a private
  Storage bucket, records an `uploads` row. Returns a reference id
  used inside `answers`, never a public URL.

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

`GET /api/integrations/google/start` — begins OAuth (auth required).
`GET /api/integrations/google/callback` — token exchange, stores
encrypted tokens, never returns them to the client.
`POST /api/integrations/google/disconnect` — revokes + deletes stored
tokens.

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
