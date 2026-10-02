# Database

Postgres via Supabase. This document is the narrative companion to
`supabase/migrations/*`; the migrations are the actual source of
truth — if this doc and a migration disagree, the migration wins and
this doc needs fixing.

## Core tables (Phase 1)

- `profiles` — 1:1 with `auth.users`, extra profile fields (name).
- `workspaces` — tenant boundary. `owner_id → profiles`.
- `workspace_members` — `(workspace_id, user_id, role)`, unique pair.
  Roles: `owner`, `editor`. Every protected query joins through this.
- `forms` — stable id, `workspace_id`, `slug` (unique per workspace
  region — see below), `title`, `description`, timestamps.
- `form_versions` — `form_id`, `status` (`draft`|`published`|
  `archived`), `schema` (JSONB, shaped by the Zod schema in
  `src/domains/forms/schema`), `version_number`, `published_at`.
  Exactly one `draft` row per form (partial unique index). Many
  `published`/`archived` rows accumulate over time and are never
  deleted (responses reference them).
- `responses` — `form_id`, `form_version_id`, `status`
  (`in_progress`|`partial`|`completed`), `started_at`,
  `last_active_at`, `last_question_id`, `completed_at`,
  `idempotency_key` (unique, nullable until submit), `client_revision`
  (monotonic counter for stale-write protection), `ending_id`,
  `is_preview` (bool), attribution columns (`referrer`, `utm_*`).
- `answers` — `response_id`, `question_id` (stable id, not a FK to a
  live "current" question row — it's a string key that matches the
  id inside the response's own `form_version_id` schema snapshot),
  `value` (JSONB), `updated_at`.
- `uploads` — `response_id`, `question_id`, storage path (private
  bucket), original filename, mime type as detected server-side, size,
  status (`pending`|`clean`|`quarantined`|`deleted`).
- `webhook_endpoints` — `form_id`, `url`, `signing_secret`, `enabled`.
- `webhook_deliveries` — `endpoint_id`, `response_id`, `event_id`
  (uuid, sent to consumer for idempotency), `status`
  (`pending`|`succeeded`|`failed`|`exhausted`), `attempt_count`,
  `next_attempt_at`, `last_error`.
- `sheets_connections` — `workspace_id`, encrypted OAuth tokens,
  `spreadsheet_id`, `enabled`.
- `sheets_sync_log` — `response_id`, `connection_id`, `status`,
  `attempt_count`, `last_error`.
- `analytics_events` — append-only product events
  (`form_id`, `event_type`, `is_preview`, `session_id`, `created_at`,
  minimal metadata JSONB). Not the same table as `responses`/
  `answers` — never used to compute response counts.
- `templates` — `title`, `category`, `schema` (same shape as
  `form_versions.schema`). Selecting a template copies its `schema`
  into a new form's draft; templates are never referenced live.
- `notification_settings` — `workspace_id`/`form_id`, `enabled`.

## Plans and usage (Phase 2, migration 25)

- **`plans`** — `id`, `name`, `sort_order`, `entitlements` (jsonb:
  limits as numbers, `null` = unlimited; features as booleans; keys in
  `src/domains/billing/entitlements.ts`). Seeded: free, pro, business,
  enterprise. Readable by any signed-in user; written by migrations only.
- **`workspaces.plan_id`** (default `free`) and
  **`workspaces.entitlement_overrides`** (jsonb, per-workspace
  exceptions). The `workspaces_protect_plan` trigger pins both for any
  request made with a user's session (`auth.role()` authenticated/anon):
  inserts get Free with no overrides, updates keep the old values. Only
  the service role (`npm run plan:set`) and migrations change them.
  Workspaces that existed before migration 25 got
  `{"remove_branding": true, "upload_mb": 100}` so nothing changed for them.
- **`usage_counters`** — `(workspace_id, metric, period_start)` →
  `value`, one row per calendar month (UTC). `completed_responses` is
  counted by the `responses_count_completed` trigger on the first
  transition to completed (so retries can't double count);
  `ai_credits` by the app through `increment_usage` (service role only —
  execute is revoked from users). Members can read their workspace's
  counters. Seats and storage are measured from rows, not counted.

## Identity & versioning rules encoded in schema

- Question ids are `text` (short nanoid), generated client-side at
  creation time and never reused; stored _inside_ the JSONB schema, not
  as separate relational rows — see `docs/form-schema.md` for why.
- `forms.slug` is unique per workspace (`unique(workspace_id, slug)`)
  and immutable once a form has ever been published (enforced in
  application logic + a trigger that rejects slug changes when a
  published version exists).
- `form_versions`: partial unique index
  `(form_id) where status = 'draft'` guarantees exactly one draft.
- `responses.form_version_id` has `on delete restrict` — a
  `form_versions` row can never be deleted while a response points at
  it.

## State machine enforcement

```sql
-- responses.status transitions enforced by trigger, not just app code
-- allowed: in_progress -> partial -> completed
-- forbidden: completed -> anything else
```

See migration `xxxx_response_state_machine.sql` for the trigger
function `enforce_response_status_transition()`.

## RLS posture

- `workspaces`, `workspace_members`, `forms`, `form_versions`,
  `webhook_endpoints`, `sheets_connections`: readable/writable only by
  members of the owning workspace (policy joins through
  `workspace_members`).
- `responses`, `answers`, `uploads`: creator-side read/write is scoped
  through the parent form's workspace; the _public_ insert path
  (respondent submitting) goes through a `security definer` RPC /
  route handler using the service role, not a public RLS policy that
  allows arbitrary inserts — public respondents never get a Supabase
  session, so there's no anon-role write policy to reason about for
  responses. The `f/[slug]` runtime always goes through
  `src/app/api/responses/*` route handlers.
- `analytics_events`: insert-only from the server; read scoped to
  workspace members via the owning form.

## Indexes (initial set)

- `forms(workspace_id, slug)` unique
- `form_versions(form_id, status)` (partial unique on draft, btree on
  the rest)
- `responses(form_id, status, started_at)`
- `responses(idempotency_key)` unique where not null
- `answers(response_id, question_id)` unique
- `webhook_deliveries(status, next_attempt_at)` for the retry sweep
- `analytics_events(form_id, event_type, created_at)`

Exact DDL lives in `supabase/migrations/`.
