-- Hardening (2026-11-03): operational tables don't grow forever.
--
-- Finished background work is kept 90 days (long enough to troubleshoot
-- and replay from a response's timeline), then removed: delivered or
-- given-up webhook deliveries and Sheets rows, finished connector jobs.
-- Failed or expired payment attempts go after 180 days; paid ones and
-- the payments themselves are kept. Deleted in batches so one run never
-- holds long locks. Called by the daily retention cron.

create function public.prune_operational_data(p_batch integer default 5000)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_webhooks integer;
  v_sheets integer;
  v_jobs integer;
  v_attempts integer;
begin
  delete from public.webhook_deliveries where id in (
    select id from public.webhook_deliveries
    where status in ('succeeded', 'exhausted') and updated_at < now() - interval '90 days'
    limit p_batch
  );
  get diagnostics v_webhooks = row_count;

  delete from public.sheets_sync_log where id in (
    select id from public.sheets_sync_log
    where status in ('succeeded', 'exhausted') and updated_at < now() - interval '90 days'
    limit p_batch
  );
  get diagnostics v_sheets = row_count;

  delete from public.connector_jobs where id in (
    select id from public.connector_jobs
    where status in ('succeeded', 'exhausted', 'skipped') and updated_at < now() - interval '90 days'
    limit p_batch
  );
  get diagnostics v_jobs = row_count;

  delete from public.payment_attempts where id in (
    select id from public.payment_attempts
    where status in ('failed', 'expired') and updated_at < now() - interval '180 days'
    limit p_batch
  );
  get diagnostics v_attempts = row_count;

  return jsonb_build_object(
    'webhookDeliveries', v_webhooks,
    'sheetsSyncs', v_sheets,
    'connectorJobs', v_jobs,
    'paymentAttempts', v_attempts
  );
end;
$$;

revoke all on function public.prune_operational_data(integer) from public, anon, authenticated;
grant execute on function public.prune_operational_data(integer) to service_role;
