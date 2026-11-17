-- Operational foundations (2026-11-15): auditable actions, atomic usage
-- limits and payment reconciliation.

-- 1. The audit log says why and how it went, and which request did it.
--    Existing rows: no reason, succeeded, no request.
alter table public.audit_logs
  add column reason text check (reason is null or char_length(reason) <= 500),
  add column outcome text not null default 'succeeded'
    check (outcome in ('succeeded', 'failed', 'denied')),
  add column request_id text check (request_id is null or char_length(request_id) <= 120);
create index audit_logs_request_idx on public.audit_logs (request_id)
  where request_id is not null;

-- 2. Spending a metered allowance (AI credits) in one statement: the
--    check and the increment can't be split by a second request, so two
--    at once can't both take the last credit. Returns the new total, or
--    null when it would go over the limit (null limit: unlimited).
create or replace function public.spend_usage(
  p_workspace_id uuid,
  p_metric text,
  p_limit bigint,
  p_amount bigint default 1
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period date := date_trunc('month', now() at time zone 'utc')::date;
  v_value bigint;
begin
  if p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;
  if p_limit is not null and p_amount > p_limit then
    return null;
  end if;
  insert into public.usage_counters as u (workspace_id, metric, period_start, value)
  values (p_workspace_id, p_metric, v_period, p_amount)
  on conflict (workspace_id, metric, period_start) do update
    set value = u.value + excluded.value
    where p_limit is null or u.value + excluded.value <= p_limit
  returning value into v_value;
  return v_value;
end;
$$;
revoke execute on function public.spend_usage(uuid, text, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.spend_usage(uuid, text, bigint, bigint) to service_role;

-- 3. Payment reconciliation: a pending attempt whose provider event never
--    arrived (or arrived out of order) is asked about directly, at most
--    once an hour. checked_at is when it was last asked.
alter table public.payment_attempts add column checked_at timestamptz;
create index payment_attempts_pending_idx on public.payment_attempts (created_at)
  where status = 'pending';

-- Pending attempts old enough that their event should have come (15
-- minutes) and young enough to still matter (3 days), not asked in the
-- last hour. Oldest check first.
create or replace function public.payment_attempts_to_reconcile(p_limit integer)
returns table (id uuid, provider text, provider_ref text, response_id uuid)
language sql
stable
set search_path = ''
as $$
  select a.id, a.provider, a.provider_ref, a.response_id
  from public.payment_attempts a
  where a.status = 'pending'
    and a.provider in ('stripe', 'razorpay')
    and a.created_at < now() - interval '15 minutes'
    and a.created_at > now() - interval '3 days'
    and (a.checked_at is null or a.checked_at < now() - interval '1 hour')
  order by a.checked_at nulls first, a.created_at
  limit p_limit;
$$;
revoke execute on function public.payment_attempts_to_reconcile(integer)
  from public, anon, authenticated;
grant execute on function public.payment_attempts_to_reconcile(integer) to service_role;

-- The reconciliation job joins the schedule (every 15 minutes) wherever
-- background jobs are already scheduled; schedule_background_jobs and
-- unschedule_background_jobs include it from now on.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron')
     and exists (select 1 from cron.job where jobname = 'formcraft-webhooks') then
    perform cron.schedule('formcraft-payments', '*/15 * * * *',
      $j$select public.call_cron_endpoint('/api/cron/payments')$j$);
  end if;
end;
$$;

create or replace function public.schedule_background_jobs(p_app_url text, p_cron_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_app_url !~ '^https?://[^/]+$' then
    raise exception 'app url must be like https://app.example.com (no path)';
  end if;
  if length(coalesce(p_cron_secret, '')) < 16 then
    raise exception 'cron secret is too short';
  end if;
  select id into v_id from vault.secrets where name = 'formcraft_app_url';
  if v_id is null then
    perform vault.create_secret(p_app_url, 'formcraft_app_url');
  else
    perform vault.update_secret(v_id, p_app_url);
  end if;
  v_id := null;
  select id into v_id from vault.secrets where name = 'formcraft_cron_secret';
  if v_id is null then
    perform vault.create_secret(p_cron_secret, 'formcraft_cron_secret');
  else
    perform vault.update_secret(v_id, p_cron_secret);
  end if;

  perform cron.schedule('formcraft-webhooks', '* * * * *',
    $j$select public.call_cron_endpoint('/api/cron/webhooks/dispatch')$j$);
  perform cron.schedule('formcraft-sheets', '* * * * *',
    $j$select public.call_cron_endpoint('/api/cron/sheets/dispatch')$j$);
  perform cron.schedule('formcraft-connectors', '* * * * *',
    $j$select public.call_cron_endpoint('/api/cron/connectors')$j$);
  perform cron.schedule('formcraft-digests', '5 * * * *',
    $j$select public.call_cron_endpoint('/api/cron/digests')$j$);
  perform cron.schedule('formcraft-domains', '20 */6 * * *',
    $j$select public.call_cron_endpoint('/api/cron/domains')$j$);
  perform cron.schedule('formcraft-retention', '30 3 * * *',
    $j$select public.call_cron_endpoint('/api/cron/retention')$j$);
  perform cron.schedule('formcraft-payments', '*/15 * * * *',
    $j$select public.call_cron_endpoint('/api/cron/payments')$j$);
end;
$$;

create or replace function public.unschedule_background_jobs()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job text;
begin
  foreach v_job in array array[
    'formcraft-webhooks', 'formcraft-sheets', 'formcraft-connectors',
    'formcraft-digests', 'formcraft-domains', 'formcraft-retention',
    'formcraft-payments'
  ] loop
    if exists (select 1 from cron.job where jobname = v_job) then
      perform cron.unschedule(v_job);
    end if;
  end loop;
end;
$$;
revoke all on function public.schedule_background_jobs(text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.unschedule_background_jobs()
  from public, anon, authenticated, service_role;
