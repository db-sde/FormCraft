# Architecture

## Shape

Modular monolith. One Next.js application, App Router, deployed as a
single unit. Domain boundaries are enforced by directory + import
convention, not by network calls.

```
src/app/(marketing)     public marketing pages
src/app/(auth)          signup, login, forgot/reset password
src/app/(dashboard)     authenticated creator app (workspace-scoped)
src/app/f/[slug]        public respondent runtime (no auth)
src/app/api             route handlers (webhooks receiver, exports,
                         submission endpoint, integration callbacks)
src/domains/*           business logic, one folder per domain
src/lib                 cross-cutting infra (supabase clients, shared
                         validation, shared api helpers)
supabase/migrations     schema source of truth
```

Rule: `src/app/**` (routes, server actions, route handlers) is the
only layer allowed to know about HTTP/Next.js concepts. It calls into
`src/domains/*` for everything else. Domains do not import from
`src/app`. Domains may import from `src/lib` and from each other only
in the direction the product dependency graph allows (e.g. `responses`
depends on `forms`, not the reverse).

## Request lifecycle (protected operation)

```
request
  → Supabase session read (server-side, cookies)
  → resolve current user
  → resolve workspace_id from route/body
  → verify workspace_membership row exists for (user, workspace)
  → verify role/permission for the specific action
  → validate input (zod) — reject on first failure, no partial writes
  → execute domain function inside a transaction where multi-row
    invariants are involved
  → return typed result / typed error
```

No route handler or server action writes to Postgres without going
through this sequence. RLS is the second line of defense, not the
only one — app-level checks stay explicit so failures are debuggable
and don't rely solely on policy behavior.

## Form schema pipeline

Six explicit stages, kept as separate functions/types so failures are
attributable:

1. **Transport decoding** — raw JSON → typed shape (no semantics yet).
2. **Structural validation** (Zod) — required fields present, correct
   types, no duplicate IDs.
3. **Semantic validation** — references resolve (logic targets exist,
   option IDs referenced by logic exist), no impossible configs.
4. **Publication validation/compilation** — the stricter pass run only
   at publish time: every question reachable, no dangling logic
   targets, endings valid, produces a deterministic compiled version.
5. **Persistence representation** — what's stored in
   `form_versions.schema` (JSONB, but shaped by the versioned Zod
   schema — never opaque).
6. **Runtime representation** — what the builder/preview/public runtime
   render from; derived from persistence representation, never
   re-fetched ad hoc per component.

Preview and the published public runtime share the same logic
evaluation function (`src/domains/logic`) so behavior cannot drift
between the two.

## Versioning

```
forms (stable id, slug)
  → draft (mutable, lives in form_versions with status='draft', one
    per form, upserted in place)
  → publish → new immutable row, status='published',
    published_at set, previous published version's status becomes
    'archived' (kept, never deleted — responses may reference it)
responses.form_version_id → FK to the exact form_versions row used
```

Editing the draft never touches published/archived rows. The public
runtime only ever reads the form's currently published
`form_versions` row.

## Response state machine

```
IN_PROGRESS → PARTIAL → COMPLETED
```

- Created on first paint of the public runtime (`POST
/api/responses/start`), status `IN_PROGRESS`.
- Debounced autosave (`PATCH /api/responses/:id/answers`) moves it to
  `PARTIAL` once at least one answer is persisted, updates
  `last_active_at` and `last_question_id`, and carries a monotonic
  `client_revision` the server uses to reject stale/out-of-order
  writes (`update ... where revision < :incoming` semantics — an
  older write loses, never overwrites a newer one).
- Final submit (`POST /api/responses/:id/complete`) is idempotent via
  a client-generated `idempotency_key` (unique constraint); a DB
  trigger/check constraint blocks any transition out of `COMPLETED`.
- A response's `form_version_id` never changes after creation.

Full detail: `docs/database.md`.

## Integrations as side effects

Webhook deliveries and Google Sheets writes are rows
(`webhook_deliveries`, `sheets_sync_log`) created _after_ the
canonical response commit, processed by a retry-with-backoff worker
path (invoked via a route handler triggered post-commit + a cron-style
retry sweep). Their failure state is visible to the creator but never
rolls back or blocks the response write.

## Analytics

PostHog captures product events (`form_viewed`, `form_started`,
`form_submitted`, etc.) with `is_preview: boolean` on every event;
production completion-rate math (`completed / valid starts × 100`)
lives in `src/domains/analytics` and explicitly filters
`is_preview = false`. It is never derived from raw HTTP log counts.

## Observability

Sentry wraps route handlers/server actions for error capture.
Structured log helper (`src/domains/observability`) tags every log
line with `operation`, `outcome` (success/rejected/conflict/retry/
unknown), and a request-scoped correlation id. Secrets are never
logged (see `CLAUDE.md` rule 8).
