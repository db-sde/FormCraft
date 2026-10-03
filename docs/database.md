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

## Resume links and random seeds (migrations 26–27)

- **`forms.resume_links_enabled`** (default false) — creator switch for
  P2.8.
- **`resume_tokens`** — `token_hash` (SHA-256 hex, the token itself is
  only in the link), `response_id`, `created_at`, `expires_at` (+30
  days), `revoked_at`. RLS on with no policies: server only. The
  `responses_revoke_resume_tokens` trigger revokes a response's links
  when it completes.
- **`responses.random_seed`** — the seed a response's question pools
  and option order were drawn from (null for older responses).

## Teams and folders (migration 28)

- **Roles:** `workspace_role` adds `admin` and `viewer` to `owner` and
  `editor`. `can_edit_workspace(id)` (owner/admin/editor) and
  `can_admin_workspace(id)` (owner/admin) are the security-definer
  checks. Every write policy (forms, form_versions, responses delete,
  notification_settings, webhook_endpoints, sheets_connections, folders,
  theme-assets storage) uses "can edit"; reads stay "is a member".
- **Members:** the owner (by `workspaces.owner_id`) and admins manage
  `workspace_members`. The `workspace_members_protect_owner` trigger
  stops anyone removing or re-roling the owner's row and stops anyone
  else holding `owner`. Ownership transfer isn't offered yet.
- **`workspace_invitations`** — email (lowercased), role
  (admin/editor/viewer), SHA-256 `token_hash`, `invited_by`, 7-day
  `expires_at`, `accepted_at`, `revoked_at`; one open invitation per
  address per workspace. Admins read and revoke; creating and accepting
  are server-side (seat limit from the plan, invited address must match
  the accepting account).
- **`profiles`:** people who share a workspace can read each other's
  name and email (`shares_workspace_with`), for the members list.
- **`folders`** — `workspace_id`, `name`. `forms.folder_id` is
  `on delete set null`: deleting a folder never deletes forms. The
  `forms_check_folder` trigger keeps a form out of another workspace's
  folder.

## Custom domains (migration 29)

- **`custom_domains`** — `workspace_id`, `hostname` (unique, lowercase),
  `status` (pending / verified / error), `verification_token` (32 hex,
  published in a TXT record), `default_form_id` (what the bare domain
  opens; same workspace, enforced by trigger), `verified_at`,
  `last_checked_at`, `last_error`. Members read; admins pick the default
  form and delete; adding and every status change go through the server
  (the `custom_domains_protect_status` trigger pins status, token,
  hostname and workspace for user sessions).
- **`resolve_custom_domain(hostname)`** — security definer, callable
  without a session: returns `(domain_id, default_slug)` for a
  _verified_ domain only. Used by `src/proxy.ts`.

## Outbound integrations (migration 30)

- **`webhook_endpoints.kind`** (`webhook` / `slack` / `zapier` / `make`),
  **`config`** (jsonb; Slack: `questionIds`), **`api_key_id`** (the key
  that made a Zapier/Make subscription; `on delete cascade`, and the
  `api_keys_drop_subscriptions` trigger deletes them when the key is
  revoked). A check keeps Slack URLs on `https://hooks.slack.com/`.
- **`confirmation_emails`** (one row per form): `enabled`,
  `recipient_question_id`, `subject`, `body` (plain text with recall),
  optional `cta_label` / `cta_url` (https). Members read, editors manage.
- **`confirmation_email_log`** — one row per response (primary key), the
  claim that makes sending at-most-once; server only.
- **`forms.ga_measurement_id` / `gtm_container_id` / `meta_pixel_id`** —
  format-checked identifiers (never code).
- **`api_keys`** — `name`, `prefix` (to recognise), `key_hash`
  (SHA-256), `created_by`, `last_used_at`, `revoked_at`. Admins read and
  revoke; creating is server-side.

## CRM, payments and languages (migrations 31–32)

- **`responses.language`** — the language a response was given in (P2.21).
- **`integration_credentials`** — `(workspace_id, provider)` unique;
  `encrypted` (AES-256-GCM `{iv, authTag, ciphertext}`, key from
  `APP_SECRET`), `label` (masked), `status` (ok / invalid). RLS on with
  no policies: server only. Members see a safe summary through
  `integration_status(workspace_id)`.
- **`webhook_endpoints.kind`** also allows `hubspot` (config: `mapping`,
  property → question id[.field]).
- **`forms.payment_config`** — `{ amount | amountVariableId, currency,
description }` or null.
- **`payments`** — one per response: `amount` (minor units, computed on
  the server), `currency`, `status` (pending / paid / failed / expired /
  canceled), `checkout_session_id`, `livemode`, `paid_at`. Members read;
  only the server writes (Stripe webhook or a server-side session check).

## Phase 3 (migrations 33–37)

- **`audit_logs`** (33) — `workspace_id`, `actor_id` (null for the
  system or an API key), `action` (`area.verb`), `target_type`,
  `target_id`, `metadata` (never secrets or answers). Owners and admins
  read; no write policies (the server writes with the service role).
- **`form_versions.published_by`** (33) — who published each version.
- **`workspaces.response_retention_days`** (33) — 7–3650 or null (keep).
- **`api_keys.scopes`** (34) — subset of `forms:read`, `responses:read`,
  `hooks:write`; defaults to all three.
- **`workspace_members.permissions`** (34) — per-member overrides
  (`{ "view_responses": false, … }`) on top of the role's defaults,
  read by `has_permission(workspace, permission)`. Owners and admins
  always have everything. Responses, answers, uploads (and their files)
  need `view_responses`; integration settings need `manage_integrations`.
- **`response_source_conversion(form, since?)`** (35) — starts and
  completions per traffic source (UTM source, else referring host, else
  Direct), without previews or spam. Security invoker.
- **`experiments`** (36) — an A/B test: `form_id` (arm A, whose link is
  shared), `variant_form_id` (arm B), `split` (% to B), `status`
  (running / stopped, never restarted), `winner`. A trigger keeps both
  arms in the experiment's workspace; one running test per form.
  Publishers create and stop. **`responses.experiment_id`** — the test
  that served a response; `experiment_stats(experiment)` counts per arm.
- **2FA (37)** — `mfa_satisfied()`: true for an `aal2` session or a user
  with no verified factor. Every RLS table gets a restrictive policy
  requiring it, and the membership helpers (`is_workspace_member`,
  `can_edit_workspace`, `can_admin_workspace`, `has_permission`,
  `workspace_role_for`, `shares_workspace_with`) include it, so a
  password-only session reads nothing. **`mfa_recovery_codes`** —
  SHA-256 hashes, `used_at`; server only.

## AI analysis (migration 38)

All written by the server only; readable with `view_responses`.

- **`response_insights`** — one per analysed response: `sentiment`
  (positive / neutral / negative / mixed), `tags` (≤ 5), `lead_score`
  (0–100) and `lead_reason` when the form has lead criteria.
- **`form_ai_summaries`** — one per form: `summary`
  (`{ overview, themes: [{ title, description, quotes }] }`),
  `response_count`, `generated_by`, `generated_at`.
- **`forms.ai_lead_criteria`** — what a good lead looks like, in words.
- **`response_followups`** — `(response_id, question_id)` unique:
  the AI-written `prompt` and the respondent's `answer`.

**New tables** must add the `"mfa: second factor when enrolled"`
restrictive policy themselves (migration 37 only covered tables that
existed); `tests/unit/mfa-policy-coverage.test.ts` fails otherwise.

## SSO, SCIM and privacy requests (migrations 39–40)

- **`workspace_sso`** — `workspace_id`, `domain`, `provider_id` (the
  Supabase SSO provider), `enforced`, `default_role`. Members read;
  admins may update only `enforced` and `default_role` (column grant) —
  the mapping itself is written with the service role
  (`npm run sso:set`).
- **`sso_satisfied(workspace)`** — true unless the workspace requires
  SSO and this session isn't one (`jwt_has_sso(auth.jwt())` reads the
  `amr` claim); the owner is always let in. It is part of every
  membership helper, alongside `mfa_satisfied()`.
  `workspaces_requiring_sso()` tells the app how many of the caller's
  workspaces are locked this way.
- **`scim_tokens`** — one per workspace, SHA-256, server only
  (`scim_status(workspace)` gives admins the prefix and dates).
- **`scim_users`** — the directory the identity provider maintains:
  `email` (lowercase, unique per workspace), `display_name`,
  `external_id`, `active`, `user_id` once they've signed in. Server only.
- **`responses_by_email(workspace, email)`** — responses where an answer
  is exactly that address or a contact step has it (security invoker).

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
