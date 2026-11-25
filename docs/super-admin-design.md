# Super Admin: design for the lean launch (32 features)

Status: 25 November 2026. Phases 0–2 are live (migrations 70–72):
customer directory, 360 view, account status, plan changes, reports,
operations and alerts. Phase 3 (the AI gateway: settings, cost, ceiling,
pause) is built (migration 73). Billing-provider sync, the admin Vercel
project and Phases 4–5 are not. See DECISIONS.md.
Source: _FormCraft Super Admin Lean Launch Developer Roadmap_ v2.0
(ADM-001–ADM-112, 32 Build Now). This document says **how** to build them
on FormCraft's current stack, safely, with the fewest new moving parts.

---

## 1. The short version

- **One codebase, two Vercel projects.** The customer app (today's
  project) and a new **admin project** deploy the same repository. Admin
  pages exist only when `ADMIN_SURFACE=1`, which only the admin project
  sets. Admin-only secrets (billing keys, Supabase management token)
  live only there, its domain gets its own firewall rules, and a bug in
  a public form page can't reach them.
- **The database is the gatekeeper.** Every admin read and write is a
  `admin_*` Postgres function that checks, inside the database, that the
  caller is active staff with the permission, signed in with a second
  factor _in this session_, on a session that still exists. The portal
  calls them with the staff member's own token, never the service role,
  so every row change is attributable and a page bug can't widen access.
- **Nothing privileged happens without a record.** The audit write is
  in the same transaction as the action (no action without its entry),
  the log is insert-only and hash-chained, and its head is copied
  outside the database daily.
- **High-risk actions need two people.** A request binds the exact
  change; a different staff member approves it after re-entering their
  second factor; the database refuses to run it otherwise.
- **FormCraft stays the source of truth** for plans, entitlements,
  status and quotas. The billing provider owns invoices and dunning; its
  events are applied idempotently and order-independently, with nightly
  reconciliation.
- **No new paid vendors** except the billing provider. Everything else
  reuses Supabase, Vercel, Resend, PostHog (key pending) and the
  existing job queue.

---

## 2. What the codebase gives us today

| Area          | Have                                                                                                                                | Gap                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Identity      | Supabase Auth; TOTP 2FA; SSO/SCIM for customer workspaces; `requireUser()` and the DB treat the proxy as UX only                    | No staff concept. 2FA is "when enrolled" (`mfa_satisfied()`), not mandatory         |
| Authorization | RLS on every table, `has_permission()`, explicit grants (migration 61), service-role allowlist test                                 | Nothing cross-tenant by design, which is right for customers                        |
| Audit         | `audit_logs` with reason, outcome, request id                                                                                       | Workspace-scoped only (`workspace_id not null`), editable by service role, no chain |
| Plans         | `plans` table, `workspaces.plan_id` + `entitlement_overrides`; a trigger lets only the service role change them; `npm run plan:set` | No subscription provider for FormCraft's own revenue                                |
| Usage         | `usage_counters`, `analytics_daily`, storage totals, account events                                                                 | No platform-wide reports                                                            |
| AI            | Credits per plan, spent atomically (`spend_usage`)                                                                                  | Five modules call Anthropic directly; model is a constant; no token/cost record     |
| Reliability   | Retried queues, `/api/cron/health`, request ids                                                                                     | No platform view; scheduler failures went unnoticed for days (CRON_SECRET)          |
| Privacy       | Per-workspace find/export/erase; daily retention                                                                                    | No platform request queue, deadlines or run records                                 |
| Backups       | —                                                                                                                                   | **Never confirmed or restore-tested** (security inventory risk 5)                   |

### Findings to fix regardless of the admin build

Status on 24 November 2026: 1, 3, 4 and 5 done (see DECISIONS.md);
2 needs a Supabase plan upgrade (the project has **no backups** and no
PITR today).

1. **Preview deployments share production's `APP_SECRET`.** It signs the
   visitor, unlock and response-write cookies; anything built on a
   preview could mint cookies production accepts. Give Preview its own.
2. **Backups unconfirmed.** Confirm the Supabase plan has daily backups
   (PITR if affordable) and run one restore into a spare project.
3. **Supabase keys.** Move from the legacy JWT `service_role` key to the
   new revocable **secret keys**, one per use (customer app, admin
   project, cron), so one can be revoked without the others.
4. **Database network.** Turn on SSL enforcement and network
   restrictions for direct Postgres (the app uses the HTTPS API; only CI
   and migrations need Postgres).
5. **Preview protection.** Keep Vercel Standard Deployment Protection on
   for previews of both projects.

---

## 3. Architecture

```
 Staff browser ── https://admin.<domain> ──► Vercel WAF (IP allowlist, rate rules)
                                              │
                               Admin project (same repo, ADMIN_SURFACE=1)
                               ├─ proxy: host check, strict CSP, no-store, noindex
                               ├─ /admin pages + server actions
                               │    requireStaff() ─► UX and early refusal only
                               └─ supabase client with the STAFF's session
                                              │  (never the service role)
                                              ▼
                     Postgres: admin_* SECURITY DEFINER functions
                     ├─ check_staff(permission, step_up?)    ← the real gate
                     ├─ action + log_admin_action() in one transaction
                     └─ admin tables: no grants to anon/authenticated

 Billing provider ──webhook──► /api/billing/webhook (verify, store event, 200)
                                 └─► queue ─► fetch current object ─► apply_subscription()
 pg_cron ──► /api/cron/* (reconcile billing, verify audit chain, anchor head, alerts)
 Customer project (ADMIN_SURFACE unset): admin routes 404, no admin secrets
```

### 3.1 Why two Vercel projects, one repository

| Option                                             | Verdict                                                                                                                                                                                                    |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin pages in the customer project under `/admin` | Simplest, but admin secrets sit in the public app's environment and its firewall can't allowlist one path's users without care                                                                             |
| **Same repo, separate admin project**              | **Chosen.** Shared code and UI kit; separate env (billing and management secrets only there), domain, firewall rules, logs and deploy cadence. Customer build has the admin surface compiled out by a flag |
| Separate admin app/repo                            | Duplicated domain code drifts; more to maintain                                                                                                                                                            |
| Appsmith / Retool                                  | Fast screens, but a second auth system and broad DB credentials in a third party; violates "FormCraft owns authority" unless it only calls our API, at which point it saves little                         |

Mechanics: a build-time flag `ADMIN_SURFACE`. In the customer project,
`src/app/(admin)` routes call `notFound()` before anything else and the
proxy refuses the admin host; in the admin project, customer routes
other than auth redirect to `/admin`. The admin project's
`SUPABASE_*` key is its own secret key.

### 3.2 Staff identity

- **Separate accounts.** Staff use a staff-only account (staff email
  domain), not their customer account. Staff accounts own no
  workspaces; a trigger refuses `workspace_members` rows for staff user
  ids, and the "first sign-in creates a workspace" step
  (`ensureDefaultWorkspace`) skips them.
- **Who is staff** is a row in `staff_members` (role, status), written
  only by `admin_*` functions under approval, or by a bootstrap CLI run
  once with a secret key for the first owner. Never a JWT custom claim:
  claims are frozen until the token refreshes (up to an hour); a table
  check revokes instantly.
- **Second factor always.** `check_staff` requires `aal = aal2` for
  every call, whether or not the user "enrolled". TOTP today. Supabase
  hosted projects don't yet accept WebAuthn as a second factor (passkeys
  sign in at AAL1 only), so hardware keys come later; until then the
  firewall IP allowlist is the extra network factor.
- **Sessions.** `check_staff` also requires that the token's
  `session_id` still exists in `auth.sessions` (signing a staff member
  out, or disabling them, cuts access at once, not at token expiry), and
  that the session is younger than 12 hours (absolute) and was active in
  the last 30 minutes (idle). (`auth.sessions` columns such as
  `refreshed_at` are Supabase internals: pin them with a test that fails
  if Supabase changes them.) Set Supabase's session time-box and
  inactivity timeout too.
- **Step-up for high risk.** The JWT's `amr` lists each method with a
  timestamp. High-risk calls and every approval require a TOTP
  verification within the last 10 minutes; the portal asks for a fresh
  code first.
- **Login hardening.** Admin login only on the admin host; rate limits
  per IP and per account (existing shared limiter); generic errors; an
  alert on repeated failures or a new IP for a staff account.

### 3.3 Roles and permissions (ADM-016, ADM-017)

Roles map to permissions in code and in one SQL function, the same
pattern as workspace permissions, with per-staff overrides that can only
**remove** permissions (never add beyond the role).

| Permission                           | owner | admin | support | billing          | privacy          | read_only |
| ------------------------------------ | ----- | ----- | ------- | ---------------- | ---------------- | --------- |
| customers.read                       | ✓     | ✓     | ✓       | ✓                | ✓                | ✓         |
| customers.status (restrict/suspend)  | ✓     | ✓     | request | —                | —                | —         |
| plans.read / billing.read            | ✓     | ✓     | ✓       | ✓                | —                | ✓         |
| plans.change / entitlements.override | ✓     | ✓     | request | ✓                | —                | —         |
| ai.settings                          | ✓     | ✓     | —       | —                | —                | —         |
| privacy.manage / privacy.execute     | ✓     | ✓     | —       | —                | ✓                | —         |
| comms.send                           | ✓     | ✓     | request | —                | —                | —         |
| ops.read (health, webhooks, backups) | ✓     | ✓     | ✓       | —                | —                | ✓         |
| staff.manage                         | ✓     | —     | —       | —                | —                | —         |
| approvals.decide                     | ✓     | ✓     | —       | ✓ (billing only) | ✓ (privacy only) | —         |

"request" means they can file a change request but not run it.

### 3.4 The gate: `check_staff()`

```sql
-- Called first by every admin_* function. Returns the staff id, or null
-- after recording the denial. It must NOT raise: an exception would roll
-- back the "denied" audit row together with everything else.
create function private.check_staff(p_permission text, p_step_up boolean default false)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_jwt jsonb := auth.jwt(); v_staff record; v_why text;
begin
  if v_uid is null or v_jwt ->> 'aal' is distinct from 'aal2' then
    v_why := 'no_second_factor';
  -- The session must still exist (sign-out / disable is immediate) and be fresh.
  elsif not exists (
    select 1 from auth.sessions s
    where s.id = (v_jwt ->> 'session_id')::uuid and s.user_id = v_uid
      and s.created_at > now() - interval '12 hours'
      and coalesce(s.refreshed_at, s.created_at) > now() - interval '30 minutes'
  ) then v_why := 'session_expired';
  else
    select * into v_staff from private.staff_members
      where user_id = v_uid and status = 'active';
    if not found or not private.staff_has(v_staff, p_permission) then
      v_why := 'not_permitted';
    elsif p_step_up and not private.recent_totp(v_jwt, interval '10 minutes') then
      v_why := 'step_up_required';
    end if;
  end if;
  if v_why is not null then
    perform private.log_admin_action(v_staff.id, p_permission, 'denied', v_why);
    return null;
  end if;
  return v_staff.id;
end $$;

-- Every admin_* function then starts:
--   v_staff := private.check_staff('customers.status', true);
--   if v_staff is null then return jsonb_build_object('ok', false, 'code', 'denied'); end if;
```

Because it returns instead of raising, the denial's audit row commits,
and the portal shows a plain "not allowed" (or asks for a fresh code on
`step_up_required`). Denials per staff member are counted for alerts.
Admin tables live in a `private` schema with **no** grants to `anon` or
`authenticated`; only `admin_*` functions in `public` are executable by
`authenticated`, and each one starts with `check_staff`. A CI test
(like the existing service-role allowlist) fails if any `admin_*`
function doesn't.

`set statement_timeout = '5s'` and `set search_path = ''` on every
admin function; all inputs are parameters (no dynamic SQL) so search
can't inject.

### 3.5 Privileged-action audit (ADM-021)

```
private.platform_audit_log(
  id bigserial, at timestamptz, staff_id, action text, target_type, target_id,
  workspace_id null, reason text, outcome ('succeeded'|'failed'|'denied'),
  approval_id null, request_id, ip inet, user_agent, details jsonb,  -- no answers, no secrets
  prev_hash bytea, row_hash bytea)
```

- Written only by `log_admin_action()`, called **inside** each admin
  function, so the action and its entry commit or roll back together.
- Insert-only: no update/delete grants to anyone, plus a trigger that
  raises on update/delete/truncate.
- Hash chain: `row_hash = sha256(prev_hash || canonical(row))`, computed
  under an advisory lock so concurrent writes keep one chain.
- A nightly job verifies the chain and writes the head hash to a place
  the database can't rewrite (an email to owners and an object in a
  write-once bucket). A superuser could still rewrite rows; the anchor
  makes that detectable.
- Reading personal details (a customer's 360 view, an export) is logged
  as `customer.viewed`/`privacy.exported`, not only changes.
- Customer-visible actions (plan change, suspension) are also written to
  that workspace's own `audit_logs` as "FormCraft support", so customers
  see what staff did to their account.

### 3.6 Two-person approvals (ADM-112)

```
private.change_requests(id, action, target_type, target_id, payload jsonb,
  payload_hash bytea, reason, requested_by, requested_at, expires_at (24h),
  status ('pending'|'approved'|'rejected'|'executed'|'expired'|'failed'),
  decided_by, decided_at, decision_note, executed_at, result jsonb,
  check (decided_by is distinct from requested_by))
```

- High-risk actions **only** run through `admin_execute_request(id)`,
  which checks: approved, not expired, approver ≠ requester (also a
  check constraint), payload hash unchanged, the approver still holds
  the permission, and the target's state still matches what the request
  expected (e.g. still on the plan it was on). It runs once
  (`status` moves to `executed` in the same transaction).
- Approving requires step-up (fresh TOTP).
- High-risk list at launch: suspend/unsuspend, delete a workspace or
  account, grant or remove a paid plan or override outside the price
  list, privacy erasure, staff role grant or removal, AI model or global
  AI switch change, customer broadcast, plan definition (entitlements)
  change.
- **Break-glass**: an owner may run one high-risk action without a
  second approver only with `emergency=true` and a reason; it alerts all
  owners immediately and creates a mandatory after-review request.

### 3.7 Customers and status (ADM-008/009/010/012)

- **Directory**: `admin_search_customers(q, cursor)` over user emails,
  names, workspace names/slugs, custom domains. `pg_trgm` indexes;
  keyset pagination; 50 per page; minimum 2 characters.
- **360 profile**: one `admin_customer_profile(workspace_id)` returns
  JSON: members (email, role, 2FA on/off), plan, overrides,
  subscription state, usage this month, forms/responses/storage counts,
  connected integrations (names and health only), payment setup
  (connected or not), recent workspace audit, privacy requests, status
  history. **Never** respondent answers, file contents or secrets.
- **Status**: `workspaces.status in ('active','restricted','suspended')`
  plus reason, by, until. Enforced in the database, not pages:
  - a restrictive RLS policy on tenant tables: suspended → no writes;
    restricted → no new forms/publishing;
  - public forms: `check_availability` returns closed for suspended;
  - API keys and webhooks out: the auth helper and dispatchers check it;
  - data is never deleted by a status change.
- Impersonation ("view as customer") is **not** in the 32 and is not
  built. If ever needed: read-only, time-boxed, approved, banner shown,
  every page view audited.

### 3.8 Billing and entitlements (ADM-029/030/031/032/036/040)

Keep FormCraft authoritative; treat the provider as an input.

```
private.billing_customers(workspace_id, provider, provider_customer_id unique)
private.subscriptions(id, workspace_id, provider, provider_subscription_id unique,
  price_id, plan_id, status, current_period_end, cancel_at, grace_until, updated_from_event)
private.billing_events(provider, event_id unique, type, received_at, processed_at, error)
private.price_plans(provider, price_id, plan_id)   -- the only price→plan mapping
```

- **Webhook**: verify the signature, insert `billing_events` (unique
  event id → duplicates are no-ops), return 200 at once; a worker then
  **fetches the current subscription from the provider** and calls
  `apply_subscription()`, which sets `workspaces.plan_id` from
  `price_plans`. Order of events doesn't matter because state comes from
  the provider's current object, not the event.
- **Reconciliation**: nightly, list active/past-due subscriptions at the
  provider and compare; fix drift through the same function; alert if
  anything was off.
- **Failed renewal (ADM-040)**: provider retries and emails; FormCraft
  marks `past_due` with a `grace_until` (proposal: 7 days), shows a
  banner, then applies Free entitlements (status `restricted` for
  over-limit features). Data is kept; paying restores everything.
- **Plans and entitlements (ADM-029/030)**: the existing `plans` table
  stays the definition; changes go through approval. Per-workspace
  overrides remain (they're how sales deals work), audited with reason.
- **Revenue (ADM-036)**: the provider's dashboard is the revenue
  dashboard; the portal shows MRR and counts from `subscriptions` and
  links out.
- **Provider choice** (decision needed):

| Provider               | Fits when                                       | Notes                                                                                                      |
| ---------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Razorpay Subscriptions | Indian entity, mostly Indian customers          | `subscription.charged/pending/halted`; halted stops auto-charges, so recovery is a link/email; UPI autopay |
| Stripe Billing         | Selling internationally from a supported entity | Mature dunning and customer portal; check Stripe India's rules for international payments                  |
| Paddle                 | Selling globally without handling sales tax/VAT | Merchant of record: they collect and remit tax; higher fee                                                 |

The schema above is provider-agnostic, like today's `payments` code.

- **Keys**: the billing secret key lives only where it's used. Checkout
  creation is customer-facing (customer project, restricted key with
  only checkout/portal permissions); webhooks and reconciliation run in
  the admin project with the full key.

### 3.9 Usage and product reporting (ADM-043/044/050/052/055)

Read-only `admin_*` reports over what already exists, no new tracking of
answers:

- Active users/workspaces (7/30 days): sign-ins, form edits, responses
  received; from `auth.users.last_sign_in_at`, `forms.updated_at`,
  `analytics_daily`.
- Feature adoption: count of workspaces with each feature **configured**
  (webhooks, apps, domains, payments, AI used, custom CSS…), from their
  own tables.
- Form inventory: forms across workspaces with status, response counts,
  created/updated, flags (abuse reports, closed). No question content.
- Submission volume: `analytics_daily` rollups by day/plan.
- Resource usage: `usage_counters` + storage per workspace.
- Heavy queries read rollups only, with `statement_timeout` and keyset
  pages. PostHog (once its key is set) covers funnels; no answers or
  personal data are sent to it.

### 3.10 AI operations (ADM-064/065/068/069)

- **One gateway**: `domains/ai/gateway.ts` `callModel(feature, workspaceId,
input)`; the five existing call sites move onto it, and a CI test
  forbids `new Anthropic(` anywhere else.
- It checks, in order: global AI switch, feature enabled, workspace
  quota (`spend_usage`, atomic), then uses the model from
  `private.ai_settings(feature, model, max_tokens, enabled)`; models
  must be on an allowlist in code (an unknown id is refused, so a bad
  setting can't route to an arbitrary model).
- It records `private.ai_usage(workspace_id, feature, model,
input_tokens, output_tokens, cost_micros, latency_ms, outcome,
request_id)` from the API's usage block; cost from a versioned
  `ai_prices` table. **No prompts or outputs stored.**
- Quotas: plan credits stay; per-workspace overrides via entitlements;
  a daily platform cost ceiling that turns AI off and alerts.
- Model or switch changes are high-risk (approval + audit).

### 3.11 Reliability (ADM-059/071/077)

- **Webhook operations**: platform counts of failed/exhausted deliveries
  by kind, oldest due job, top failing endpoints (ids, not payloads),
  with the existing replay (already idempotent).
- **System health**: the existing health report plus the scheduler:
  last successful run per `cron.job` (from `cron.job_run_details`) and
  recent `net._http_response` status codes. An alert when the last
  minute of calls aren't 200 would have caught the CRON_SECRET mismatch
  in minutes.
- **Backups (ADM-077)**: Supabase Management API
  `GET /v1/projects/{ref}/database/backups` (fine-grained token with
  `backups_read` only, admin project only) shows latest backup and
  whether PITR is on; `private.restore_tests(date, backup_time,
restored_to, checks, evidence_url, by)` records each restore drill.
  The status turns red if no backup in 26 hours or no restore test in 90
  days.
- Link to Vercel, Supabase and Resend consoles rather than rebuilding
  them.

### 3.12 Privacy lifecycle (ADM-085/086/091)

- `private.privacy_requests(id, type ('access'|'erasure'|'rectification'),
requester_email, received_at, due_at (+30 days), identity_verified_at,
scope (workspaces found), status, handled_by, exemptions, evidence,
completed_at)`.
- Find/export reuse today's `responses/privacy` functions across
  workspaces; **erasure is high-risk** (approval) and the evidence
  (counts deleted, where) is stored, not the data.
- Retention: the daily job writes `private.retention_runs(workspace_id,
ran_at, deleted, errors)`, which the dashboard shows; failures alert.
- Backups keep deleted data until they age out; `docs/compliance.md`
  already says so and the request record notes it.

### 3.13 Customer communications (ADM-098)

- Transactional notices only at launch (incidents, billing, policy),
  through Resend.
- `private.messages(id, audience_query, subject, body, status
('draft'|'approved'|'sending'|'sent'), counts)`; a broadcast is
  high-risk (approval); sends go through the existing queue at a capped
  rate; each recipient send is logged; marketing email and unsubscribe
  handling are out of scope.

---

## 4. Network and platform security

| Layer        | Control                                                                                                                                                                                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DNS/TLS      | Admin on its own subdomain; HSTS (already); no wildcard certs shared with customer domains                                                                                                                                                                      |
| Edge         | Vercel WAF custom rule on the admin project: allow only listed IPs (office/VPN), deny the rest (available on all plans as a custom rule; Trusted IPs proper is Enterprise); rate-limit rule on `/admin/login`                                                   |
| Framework    | Never authorize in the proxy alone (CVE-2025-29927 showed middleware can be skipped); every server action and route re-checks, and the database decides. Keep Next.js patched; Dependabot is on                                                                 |
| Browser      | Strict CSP with nonces (already), `frame-ancestors 'none'`, `Cache-Control: no-store`, `X-Robots-Tag: noindex`, Permissions-Policy all off, cookies host-only (no `Domain`), `SameSite=Lax`, `HttpOnly`, `Secure`; server actions keep Next's same-origin check |
| Database     | SSL enforced; network restrictions on direct Postgres; separate revocable secret keys per surface; admin tables in a `private` schema with no API grants                                                                                                        |
| Secrets      | Admin-only secrets only in the admin project; Preview gets its own `APP_SECRET`; billing restricted keys where possible; rotation runbook                                                                                                                       |
| Supply chain | GitHub org 2FA required; branch protection on `main` (CI must pass, review for `supabase/migrations/**` and `src/app/(admin)/**` via CODEOWNERS); secret scanning (already)                                                                                     |
| People       | Staff list reviewed monthly (owner); access removed same day on exit; no shared accounts; the AI agent never gets staff credentials                                                                                                                             |

---

## 5. Threat model (what could go wrong, and what stops it)

| Threat                                 | Stops it                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Stolen staff password                  | Mandatory TOTP; IP allowlist; new-IP alert                                                                                                  |
| Phished TOTP / session theft           | Short idle/absolute sessions; session must exist in `auth.sessions` (instant revoke); step-up for high risk; approvals need a second person |
| Proxy/middleware bypass                | Authorization is in the database; pages only add a second check                                                                             |
| XSS in the customer app reaching admin | Separate host, host-only cookies, separate project; admin never renders customer HTML/CSS (answers aren't shown)                            |
| CSRF                                   | Server actions' origin check; SameSite cookies; no GET mutations                                                                            |
| Insider abuse (one person)             | Least-privilege roles; two-person rule for high risk; reads of personal data logged; customers see staff actions in their own audit log     |
| Two colluding staff                    | Owner alerts on every high-risk execution; monthly review of the audit trail; anchored log                                                  |
| Tampering with the audit trail         | Insert-only, trigger, hash chain, daily external anchor, nightly verification                                                               |
| Privilege escalation via staff table   | Staff changes only through approved `admin_*` functions; overrides can only remove permissions; no direct table grants                      |
| SQL injection in search                | Parameterized functions, no dynamic SQL, `search_path = ''`                                                                                 |
| Forged or replayed billing webhook     | Signature check; unique event id; state from a fresh provider fetch                                                                         |
| Out-of-order or missed billing events  | Order-independent apply; nightly reconciliation                                                                                             |
| Preview build with production data     | Previews have no DB keys (keep it so) and their own `APP_SECRET`; Standard Deployment Protection                                            |
| AI cost runaway / model misrouting     | Gateway-only calls (CI-enforced), atomic quotas, daily ceiling, model allowlist                                                             |
| Mass accidental action                 | Batch caps per call, rate limits per staff, approvals for bulk                                                                              |
| Scheduler/cron silently failing        | Health check on cron results with alert (the CRON_SECRET lesson)                                                                            |
| Data loss                              | Confirmed backups/PITR, quarterly restore drill, status visible in the portal                                                               |
| Data leak through analytics/logs       | No answers, prompts, file contents or secrets in PostHog, Sentry or logs; request ids instead                                               |

---

## 6. Data model summary

New, all in `private` unless noted: `staff_members`, `staff_permission_overrides`,
`platform_audit_log`, `change_requests`, `billing_customers`,
`subscriptions`, `billing_events`, `price_plans`, `ai_settings`,
`ai_prices`, `ai_usage`, `privacy_requests`, `retention_runs`,
`restore_tests`, `messages`, `message_sends`. Changed: `workspaces`
(+`status`, `status_reason`, `status_until`, `status_by`).
Every table: RLS on, no `anon`/`authenticated` grants, MFA restrictive
policy (the existing coverage test enforces it).

---

## 7. Phases, gates and rough effort

Effort is engineering days for one developer with this codebase, before
the roadmap's own estimate review; billing depends on the provider.

| Phase                   | Builds                                                                                                                                                                                      | Gate (automated tests unless noted)                                                                                                                                                                      | Days  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 0 Foundation            | Fix the 5 findings; admin project + flag; `staff_members`, `check_staff`, roles; audit log with chain and anchor; change requests; staff login with TOTP, session rules, step-up; CI checks | Non-staff and AAL1 get nothing; signed-out session refused at once; denied action logged; high-risk without approval fails in the DB; self-approval impossible; chain verification catches an edited row | 8–10  |
| 1 Customers and revenue | Directory, 360, status enforcement; provider adapter, webhooks, reconciliation, grace; plans/overrides UI                                                                                   | Suspended workspace: forms closed, API refused, data intact; test-mode renewal and failure update FormCraft; duplicate/out-of-order events harmless; drift fixed by reconcile                            | 10–14 |
| 2 Monitoring            | Usage/adoption/inventory/volume reports; ops screen with scheduler and delivery health; backups status; first restore drill                                                                 | Report counts equal direct SQL; a broken cron secret raises an alert; restore recorded (manual drill)                                                                                                    | 5–7   |
| 3 AI                    | Gateway, usage/cost table, settings, quotas, ceiling                                                                                                                                        | Every AI call goes through the gateway (CI); cost per workspace correct; quota can't be beaten with parallel calls; model change audited and approval-gated                                              | 4–6   |
| 4 Privacy and comms     | Request queue, cross-workspace export/erase, retention runs, broadcasts                                                                                                                     | A request completes with evidence; erasure needs approval; retention failure visible; broadcast approved, rate-limited, logged                                                                           | 5–7   |
| 5 Hardening             | Access review, outage/retry drills, restore drill, runbooks, pen-test checklist (OWASP ASVS L2 for the admin surface)                                                                       | Full suite green; drills recorded                                                                                                                                                                        | 3–5   |

About 35–49 days in all. Phases 2 and 3 can run in parallel with 1 once
Phase 0 lands.

---

## 8. Decisions needed

1. **Billing provider and selling entity/country** (Razorpay, Stripe or
   Paddle) and the grace period after a failed renewal.
2. **Admin domain** and the **IP allowlist** (office/VPN egress IPs), or
   whether staff work from changing IPs (then a VPN or Cloudflare
   Access in front becomes the network factor).
3. **First owner** and who else is staff, with roles.
4. **The high-risk list** in 3.6 and who may approve each kind.
5. **Supabase plan**: daily backups confirmed, PITR yes/no, and a
   fine-grained management token for backup status.
6. **Vercel plan** for the admin project (Pro gives 40 firewall rules
   and persistent actions).
7. Approve the 5 findings in section 2 to be fixed first.

## Sources

- Supabase: [sessions (time-box, inactivity, single session)](https://supabase.com/docs/guides/auth/sessions),
  [custom access token hook (claims frozen until refresh)](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook),
  [passkeys beta discussion](https://github.com/orgs/supabase/discussions/46458),
  [WebAuthn MFA on hosted projects](https://github.com/orgs/supabase/discussions/53011),
  [list backups API](https://supabase.com/docs/reference/api/v1-list-all-backups),
  [backups](https://supabase.com/docs/guides/platform/backups),
  [network restrictions](https://supabase.com/docs/guides/platform/network-restrictions),
  [platform security](https://supabase.com/docs/guides/security/platform-security),
  [security retro 2025 (new secret keys)](https://supabase.com/blog/supabase-security-2025-retro.md),
  [production checklist](https://supabase.com/docs/guides/security/production-checklist).
- Vercel: [WAF custom rules](https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules),
  [trusted IP access via firewall](https://vercel.com/docs/vercel-firewall/vercel-waf/trusted-ip-access),
  [Trusted IPs (Enterprise)](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/trusted-ips),
  [deployment protection](https://vercel.com/docs/deployment-protection).
- Next.js: [CVE-2025-29927](https://nvd.nist.gov/vuln/detail/cve-2025-29927),
  [Vercel's note](https://vercel.com/changelog/vercel-firewall-proactively-protects-against-vulnerability-with-middleware).
- Billing: [Razorpay subscription webhooks](https://razorpay.com/docs/webhooks/subscriptions),
  [payment retries](https://razorpay.com/docs/subscriptions/payment-retries),
  [Stripe webhooks: duplicates and ordering (Hookdeck)](https://hookdeck.com/webhooks/stripe/guide-duplicates-ordering-retries-timeouts).
- Standards: [NIST SP 800-63B-4 AAL and sessions](https://pages.nist.gov/800-63-4/sp800-63b/session),
  [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html),
  [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html),
  [OWASP ASVS session management](https://github.com/OWASP/ASVS/blob/v4.0.3/4.0/en/0x12-V3-Session-management.md).
- Audit logs: [tamper-evident trails in PostgreSQL](https://appmaster.io/blog/tamper-evident-audit-trails-postgresql),
  [hash-chained audit logging](https://norafoundation.github.io/Designing-Falsifiable-Evidence-Systems/part4_practice/24_audit_log.html).
