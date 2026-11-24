# Runbook: recovering from delayed, repeated or missing events

What to check and do when money, deliveries or usage counts look wrong.
Everything below is safe to repeat: each step is idempotent, so running it
twice never double-charges, double-delivers or double-counts.

Every API response carries an `X-Request-Id`. Error log lines, Sentry
events, audit entries and analytics events carry the same `requestId`:
start from it when someone reports a problem with a specific action.

## Payments (Stripe, Razorpay)

**How it normally works.** The provider's webhook marks the attempt paid
(`record_payment_paid`: one paid state, whatever order or how many times
events arrive). A respondent returning from Stripe also asks Stripe
directly. Every 15 minutes, `/api/cron/payments` asks the provider about
attempts still pending after 15 minutes (up to 3 days old), each at most
once an hour.

**A respondent paid but FormCraft says unpaid.**

1. Find the attempt: `select id, status, provider, provider_ref,
checked_at, created_at from payment_attempts where response_id = '…'`.
2. If `checked_at` is recent and the status is still `pending`, the
   provider didn't report it paid: check its dashboard (an authorized but
   uncaptured Razorpay payment needs capturing there).
3. To ask again now: `update payment_attempts set checked_at = null
where id = '…'`, then call the endpoint:
   `curl -X POST -H "Authorization: Bearer $CRON_SECRET"
https://<app>/api/cron/payments`.
4. Older than 3 days: the sweep no longer looks. Re-send the event from
   the provider's dashboard (Stripe: Developers → Events → Resend;
   Razorpay: Webhooks → the event → Retry), which applies it the same way.

**Paid twice.** The second payment is recorded on the response's timeline
as needing a refund; refund it in the provider's dashboard. The refund
event is recorded (and audited as `payment.refunded`).

**Webhook secret changed or wrong.** Deliveries fail signature checks and
show in the provider's dashboard as failed; update the secret in Settings
→ Connections, then resend from the provider.

## Outgoing webhooks, n8n, Sheets and app syncs

**How it normally works.** Each delivery or sync is one row in a queue
(`webhook_deliveries`, `sheets_sync_log`, `connector_jobs`) with a unique
key, retried with backoff for about a day. Recovery sweeps re-create any
that a crashed request never queued (completed responses of the last 24
hours).

- **One failed delivery:** the form's Integrations page shows it with the
  error; fix the destination, then use the response's timeline **Replay**
  (app syncs) or wait for the next retry.
- **Many exhausted:** after an outage, set them due again:
  `update webhook_deliveries set status = 'failed', attempt_count = 0,
next_attempt_at = now() where status = 'exhausted' and updated_at >
'<outage start>'` (same for `connector_jobs`). Receivers dedupe on
  `eventId`, so a repeat is harmless.
- **Nothing is being sent at all:** check the scheduler: `select jobname,
schedule from cron.job` should list the `formcraft-*` jobs, and
  `/api/cron/health` reports the oldest due job. If the jobs are missing,
  run `select schedule_background_jobs('<app url>', '<CRON_SECRET>')` as
  the database owner.

## Usage counts (responses, AI credits, address lookups)

Counts live in `usage_counters` (one row per workspace, metric and month).
Completed responses are counted by a database trigger as they complete;
AI credits and address lookups by `spend_usage` / `increment_usage`.

- **A count looks wrong:** recount completed responses for the month from
  `responses` (status `completed`, `completed_at` in the month) and
  overwrite the row; AI credits can't be recounted (no per-call log), so
  correct them by hand only with a reason recorded.
- **A workspace hit a limit it shouldn't have:** raise it with an override,
  which is audited: `npm run plan:set -- <workspace> <plan>
'{"ai_credits_per_month": 100}' --by <you> --reason "<why>"`.

## Plan and entitlement changes

Only the service role can change a workspace's plan or overrides (a
database trigger refuses members). Use `npm run plan:set` with `--by` and
`--reason`; the audit log shows who, why and when.

## Restoring data

Backups are the database host's (Supabase). Restoring is a host-level
operation; see the security inventory (risk "Backups are unconfirmed")
for the restore test that still needs doing.

## Staff and the admin portal

- **First owner** (once, from a trusted machine with the secret key): the
  person signs up with a staff-only email, then
  `npm run staff:bootstrap -- <email> "<Name>"`. The database refuses it
  once any staff exist; after that people are added in the portal through
  an approved request. Staff accounts can't belong to customer workspaces.
- **Lost authenticator**: another owner disables the account (approved
  request), which signs it out everywhere; re-add it after the person
  sets up a new authenticator. There are no staff recovery codes.
- **Audit trail damaged**: the Audit trail page (or
  `select * from admin_verify_audit_chain()` with the secret key) names
  the first entry that changed. Compare with the last fingerprint kept
  outside the database and treat it as an incident.
- **Migrations refused (network restriction)**: direct Postgres only
  accepts the allowlisted address. Update it with
  `npx supabase network-restrictions update --project-ref <ref>
--db-allow-cidr <your ip>/32 --experimental`.
