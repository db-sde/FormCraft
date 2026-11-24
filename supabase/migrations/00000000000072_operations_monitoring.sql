-- Super Admin, Phase 2 (docs/super-admin-design.md §3.9, §3.11): usage
-- and adoption reports counted from the real tables (so they reconcile),
-- the platform form inventory, resource use per workspace, delivery and
-- scheduler health, restore-test records, and alerts.
--
-- Alerts have three layers, so a broken scheduler can't hide its own
-- failure: checks run inside the database every 5 minutes (no web call
-- needed) and record what they find; the app emails owners and admins
-- (called by the database scheduler and, separately, by Vercel's daily
-- cron); and the portal shows open alerts whatever else is down.

-- ---------------------------------------------------------------------------
-- 1. Permissions and indexes
-- ---------------------------------------------------------------------------

create or replace function private.role_permissions(p_role text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'owner' then array[
      'portal.access', 'customers.read', 'customers.status', 'plans.read',
      'plans.change', 'ai.settings', 'privacy.manage', 'comms.send', 'ops.read',
      'ops.record', 'staff.manage', 'approvals.decide', 'audit.read']
    when 'admin' then array[
      'portal.access', 'customers.read', 'customers.status', 'plans.read',
      'plans.change', 'ai.settings', 'privacy.manage', 'comms.send', 'ops.read',
      'ops.record', 'approvals.decide', 'audit.read']
    when 'support' then array[
      'portal.access', 'customers.read', 'customers.status', 'plans.read', 'ops.read']
    when 'billing' then array[
      'portal.access', 'customers.read', 'plans.read', 'plans.change', 'approvals.decide']
    when 'privacy' then array[
      'portal.access', 'customers.read', 'privacy.manage', 'approvals.decide']
    when 'read_only' then array['portal.access', 'customers.read', 'plans.read', 'ops.read']
    else array[]::text[]
  end;
$$;

create index if not exists responses_completed_at_idx
  on public.responses (completed_at) where status = 'completed';

-- ---------------------------------------------------------------------------
-- 2. Reports (ADM-043/044/050/052/055)
-- ---------------------------------------------------------------------------

/** Platform totals, activity, sign-ups and submissions by day, feature
 * adoption and plan mix, counted from the real tables. */
create function public.admin_usage_overview()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '15s'
as $$
declare
  v_staff uuid := private.check_staff('ops.read');
  v_month date := date_trunc('month', now() at time zone 'UTC')::date;
begin
  if v_staff is null then return private.denial(); end if;
  perform private.log_admin_action(v_staff, 'reports.usage_viewed', 'succeeded');
  return jsonb_build_object(
    'ok', true,
    'today', (now() at time zone 'UTC')::date,
    'totals', jsonb_build_object(
      'workspaces', (select count(*) from public.workspaces),
      'users', (select count(*) from auth.users),
      'forms', (select count(*) from public.forms where deleted_at is null),
      'live_forms', (select count(distinct f.id) from public.forms f
                     join public.form_versions v on v.form_id = f.id and v.status = 'published'
                     where f.deleted_at is null),
      'responses', (select count(*) from public.responses
                    where status = 'completed' and not is_preview)),
    'active', (
      select jsonb_object_agg(p.label, jsonb_build_object(
        'users', (select count(*) from auth.users u where u.last_sign_in_at > now() - p.span),
        'workspaces', (select count(*) from (
          select f.workspace_id from public.responses r join public.forms f on f.id = r.form_id
           where r.status = 'completed' and not r.is_preview and r.completed_at > now() - p.span
          union
          select f.workspace_id from public.forms f where f.updated_at > now() - p.span
          union
          select m.workspace_id from public.workspace_members m join auth.users u on u.id = m.user_id
           where u.last_sign_in_at > now() - p.span) a)))
      from (values ('7d', interval '7 days'), ('30d', interval '30 days')) p(label, span)),
    'signups_by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'count', d.n) order by d.day)
      from (select (created_at at time zone 'UTC')::date as day, count(*) as n
            from auth.users where created_at > now() - interval '30 days' group by 1) d),
      '[]'::jsonb),
    'submissions_by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'count', d.n) order by d.day)
      from (select (completed_at at time zone 'UTC')::date as day, count(*) as n
            from public.responses
            where status = 'completed' and not is_preview
              and completed_at > now() - interval '30 days'
            group by 1) d), '[]'::jsonb),
    'adoption', jsonb_build_object(
      'webhooks', (select count(distinct f.workspace_id) from public.webhook_endpoints we
                   join public.forms f on f.id = we.form_id where we.kind = 'webhook'),
      'n8n', (select count(distinct f.workspace_id) from public.webhook_endpoints we
              join public.forms f on f.id = we.form_id where we.kind = 'n8n'),
      'slack', (select count(distinct f.workspace_id) from public.webhook_endpoints we
                join public.forms f on f.id = we.form_id where we.kind = 'slack'),
      'apps', (select count(distinct workspace_id) from public.connector_connections),
      'sheets', (select count(distinct workspace_id) from public.sheets_connections where enabled),
      'payments', (select count(distinct workspace_id) from public.integration_credentials
                   where provider in ('stripe', 'razorpay')),
      'custom_domains', (select count(distinct workspace_id) from public.custom_domains),
      'api_keys', (select count(distinct workspace_id) from public.api_keys where revoked_at is null),
      'sso', (select count(*) from public.workspace_sso),
      'bookings', (select count(distinct workspace_id) from public.booking_types
                   where archived_at is null),
      'experiments', (select count(distinct workspace_id) from public.experiments),
      'ai_this_month', (select count(distinct workspace_id) from public.usage_counters
                        where metric = 'ai_credits' and period_start = v_month and value > 0)),
    'plans', coalesce((select jsonb_object_agg(plan_id, n) from (
               select plan_id, count(*) as n from public.workspaces group by 1) p), '{}'::jsonb),
    'statuses', coalesce((select jsonb_object_agg(status, n) from (
                  select status, count(*) as n from public.workspaces group by 1) s), '{}'::jsonb)
  );
end;
$$;

/** Forms across all workspaces (ADM-050): no questions or answers. */
create function public.admin_form_inventory(
  p_query text default null,
  p_state text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_staff uuid := private.check_staff('customers.read');
  v_q text := lower(btrim(coalesce(p_query, '')));
  v_rows jsonb;
begin
  if v_staff is null then return private.denial(); end if;
  v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  select coalesce(jsonb_agg(to_jsonb(r) order by r.updated_at desc), '[]'::jsonb) into v_rows
  from (
    select * from (
      select f.id, f.title, f.slug, f.created_at, f.updated_at, f.closes_at,
        w.id as workspace_id, w.name as workspace_name, w.status as workspace_status,
        case
          when not exists (select 1 from public.form_versions v
                           where v.form_id = f.id and v.status = 'published') then 'draft'
          when f.closes_at is not null and f.closes_at <= now() then 'closed'
          else 'live'
        end as state,
        (select count(*) from public.responses r
         where r.form_id = f.id and r.status = 'completed' and not r.is_preview) as responses,
        (select max(r.completed_at) from public.responses r
         where r.form_id = f.id and r.status = 'completed' and not r.is_preview)
          as last_response_at
      from public.forms f join public.workspaces w on w.id = f.workspace_id
      where f.deleted_at is null
        and (v_q = '' or lower(f.title) like '%' || v_q || '%' or f.slug like '%' || v_q || '%'
             or lower(w.name) like '%' || v_q || '%')
    ) x
    where p_state is null or x.state = p_state
    order by x.updated_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0)
  ) r;
  perform private.log_admin_action(v_staff, 'reports.forms_listed', 'succeeded', null, null,
    null, null, null, jsonb_build_object('query', left(btrim(coalesce(p_query, '')), 120)));
  return jsonb_build_object('ok', true, 'forms', v_rows);
end;
$$;

/** The heaviest workspaces this month (ADM-055), by one measure. */
create function public.admin_resource_usage(p_sort text default 'responses', p_limit integer default 25)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_staff uuid := private.check_staff('ops.read');
  v_month date := date_trunc('month', now() at time zone 'UTC')::date;
  v_rows jsonb;
begin
  if v_staff is null then return private.denial(); end if;
  if coalesce(p_sort, '') not in ('responses', 'ai_credits', 'storage', 'forms') then
    return jsonb_build_object('ok', false, 'code', 'bad_sort');
  end if;
  with usage as (
    select w.id, w.name, w.plan_id, w.status,
      coalesce((select value from public.usage_counters c where c.workspace_id = w.id
                and c.metric = 'completed_responses' and c.period_start = v_month), 0) as responses,
      coalesce((select value from public.usage_counters c where c.workspace_id = w.id
                and c.metric = 'ai_credits' and c.period_start = v_month), 0) as ai_credits,
      coalesce((select sum(up.size_bytes) from public.uploads up
                join public.responses r on r.id = up.response_id
                join public.forms f on f.id = r.form_id
                where f.workspace_id = w.id and up.status <> 'deleted'), 0) as storage,
      (select count(*) from public.forms f where f.workspace_id = w.id and f.deleted_at is null)
        as forms
    from public.workspaces w
  )
  select coalesce(jsonb_agg(to_jsonb(u) order by case p_sort
      when 'responses' then u.responses when 'ai_credits' then u.ai_credits
      when 'storage' then u.storage else u.forms end desc), '[]'::jsonb)
    into v_rows
  from (select * from usage order by case p_sort
      when 'responses' then responses when 'ai_credits' then ai_credits
      when 'storage' then storage else forms end desc
    limit least(greatest(coalesce(p_limit, 25), 1), 100)) u;
  perform private.log_admin_action(v_staff, 'reports.resources_viewed', 'succeeded');
  return jsonb_build_object('ok', true, 'workspaces', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Operations: deliveries, scheduler, backups, alerts (ADM-059/071/077)
-- ---------------------------------------------------------------------------

create table private.restore_tests (
  id bigint generated always as identity primary key,
  tested_at timestamptz not null default now(),
  backup_time timestamptz,
  restored_to text not null check (char_length(restored_to) between 2 and 200),
  checks text not null check (char_length(checks) between 5 and 2000),
  evidence_url text check (evidence_url is null or evidence_url ~ '^https://'),
  succeeded boolean not null,
  recorded_by uuid not null references private.staff_members (user_id)
);

create table private.ops_alerts (
  id bigint generated always as identity primary key,
  kind text not null,
  severity text not null check (severity in ('critical', 'warning', 'info')),
  message text not null,
  details jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  seen_count integer not null default 1,
  notified_at timestamptz,
  resolved_at timestamptz
);
-- One open alert per kind.
create unique index ops_alerts_open_kind_idx on private.ops_alerts (kind) where resolved_at is null;

/** Opens (or refreshes) an alert of this kind. */
create function private.raise_alert(p_kind text, p_severity text, p_message text, p_details jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.ops_alerts (kind, severity, message, details)
  values (p_kind, p_severity, p_message, coalesce(p_details, '{}'::jsonb))
  on conflict (kind) where resolved_at is null
  do update set last_seen_at = now(), seen_count = private.ops_alerts.seen_count + 1,
                message = excluded.message, details = excluded.details,
                severity = excluded.severity;
$$;

create function private.resolve_alert(p_kind text)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.ops_alerts set resolved_at = now()
   where kind = p_kind and resolved_at is null;
$$;

/** The checks, run by the database scheduler every 5 minutes (no web
 * call needed, so they still run when the app can't be reached). */
create function public.ops_run_checks()
returns integer
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare
  v_calls integer;
  v_ok integer;
  v_overdue integer;
  v_exhausted integer;
  v_broken bigint;
  v_last_emergency bigint;
  r record;
begin
  -- The scheduler's calls to the app: several in 15 minutes, none answered OK.
  begin
    select count(*), count(*) filter (where status_code between 200 and 299)
      into v_calls, v_ok
      from net._http_response where created > now() - interval '15 minutes';
  exception when undefined_table or invalid_schema_name then
    v_calls := 0; v_ok := 0;
  end;
  if v_calls >= 3 and v_ok = 0 then
    perform private.raise_alert('scheduler_failing', 'critical',
      format('The scheduler''s last %s calls to the app all failed (likely the cron secret or the app is down).', v_calls),
      jsonb_build_object('calls', v_calls));
  else
    perform private.resolve_alert('scheduler_failing');
  end if;

  -- Deliveries waiting well past their time.
  select (select count(*) from public.webhook_deliveries
          where status in ('pending', 'failed') and next_attempt_at < now() - interval '30 minutes')
       + (select count(*) from public.sheets_sync_log
          where status in ('pending', 'failed') and next_attempt_at < now() - interval '30 minutes')
       + (select count(*) from public.connector_jobs
          where status in ('pending', 'failed') and next_attempt_at < now() - interval '30 minutes')
    into v_overdue;
  if v_overdue > 0 then
    perform private.raise_alert('deliveries_overdue', 'warning',
      format('%s deliveries are over 30 minutes late.', v_overdue),
      jsonb_build_object('overdue', v_overdue));
  else
    perform private.resolve_alert('deliveries_overdue');
  end if;

  select (select count(*) from public.webhook_deliveries
          where status = 'exhausted' and updated_at > now() - interval '1 hour')
       + (select count(*) from public.connector_jobs
          where status = 'exhausted' and updated_at > now() - interval '1 hour')
    into v_exhausted;
  if v_exhausted > 0 then
    perform private.raise_alert('deliveries_exhausted', 'warning',
      format('%s deliveries gave up after all retries in the last hour.', v_exhausted),
      jsonb_build_object('exhausted', v_exhausted));
  else
    perform private.resolve_alert('deliveries_exhausted');
  end if;

  -- The audit trail must be whole.
  select first_broken_id into v_broken from public.admin_verify_audit_chain();
  if v_broken is not null then
    perform private.raise_alert('audit_chain_broken', 'critical',
      format('Audit trail entry %s was changed after it was written.', v_broken),
      jsonb_build_object('first_broken_id', v_broken));
  else
    perform private.resolve_alert('audit_chain_broken');
  end if;

  -- Every emergency approval is told to owners (one alert each).
  select coalesce(max((details ->> 'audit_id')::bigint), 0) into v_last_emergency
    from private.ops_alerts where kind like 'emergency_approval:%';
  for r in
    select l.id, l.staff_id, l.reason, l.details ->> 'action' as action, l.at
      from private.platform_audit_log l
     where l.action = 'change.emergency_approved' and l.id > v_last_emergency
     order by l.id
  loop
    perform private.raise_alert('emergency_approval:' || r.id, 'warning',
      format('An owner approved a %s request without a second person: "%s".', r.action, r.reason),
      jsonb_build_object('audit_id', r.id, 'staff_id', r.staff_id, 'at', r.at));
  end loop;

  return (select count(*) from private.ops_alerts where resolved_at is null);
end;
$$;

/** For the app's alert job (service role): raise or clear an alert it
 * checked itself (the backups, from Supabase's API). */
create function public.ops_set_alert(p_kind text, p_severity text, p_message text, p_details jsonb, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind !~ '^[a-z_]{3,40}$' then raise exception 'bad kind'; end if;
  if p_active then
    perform private.raise_alert(p_kind, p_severity, left(p_message, 500), p_details);
  else
    perform private.resolve_alert(p_kind);
  end if;
end;
$$;

/** Alerts to email now: new ones, and open critical ones every 6 hours. */
create function public.ops_alerts_to_notify()
returns table (id bigint, kind text, severity text, message text, first_seen_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.kind, a.severity, a.message, a.first_seen_at
    from private.ops_alerts a
   where a.resolved_at is null
     and (a.notified_at is null
          or (a.severity = 'critical' and a.notified_at < now() - interval '6 hours'))
   order by a.first_seen_at;
$$;

create function public.ops_mark_notified(p_ids bigint[])
returns void
language sql
security definer
set search_path = ''
as $$
  update private.ops_alerts set notified_at = now() where id = any (p_ids);
  -- Emergency approvals are one-off notices: told once, closed.
  update private.ops_alerts set resolved_at = now()
   where id = any (p_ids) and kind like 'emergency_approval:%' and resolved_at is null;
$$;

/** Who gets alerts: active owners and admins. */
create function public.ops_alert_recipients()
returns table (email text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.email::text from private.staff_members s join auth.users u on u.id = s.user_id
   where s.status = 'active' and s.role in ('owner', 'admin') and u.email is not null;
$$;

/** Delivery queues, failing endpoints, the scheduler, alerts and restore
 * tests, for the operations page (ADM-059/071/077). */
create function public.admin_ops_health()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '15s'
as $$
declare
  v_staff uuid := private.check_staff('ops.read');
  v_scheduler jsonb;
  v_jobs jsonb;
begin
  if v_staff is null then return private.denial(); end if;
  begin
    select jsonb_build_object(
      'calls_60m', count(*),
      'ok_60m', count(*) filter (where status_code between 200 and 299),
      'last_ok_at', max(created) filter (where status_code between 200 and 299))
      into v_scheduler
      from net._http_response where created > now() - interval '60 minutes';
  exception when undefined_table or invalid_schema_name then
    v_scheduler := jsonb_build_object('calls_60m', 0, 'ok_60m', 0, 'last_ok_at', null);
  end;
  begin
    select coalesce(jsonb_agg(jsonb_build_object('name', jobname, 'schedule', schedule,
                                                 'active', active) order by jobname), '[]'::jsonb)
      into v_jobs from cron.job where jobname like 'formcraft-%';
  exception when undefined_table or invalid_schema_name then
    v_jobs := '[]'::jsonb;
  end;
  return jsonb_build_object(
    'ok', true,
    'queues', jsonb_build_object(
      'webhooks', (select jsonb_build_object(
          'pending', count(*) filter (where status = 'pending'),
          'retrying', count(*) filter (where status = 'failed'),
          'exhausted_24h', count(*) filter (where status = 'exhausted'
                                             and updated_at > now() - interval '24 hours'),
          'succeeded_24h', count(*) filter (where status = 'succeeded'
                                             and updated_at > now() - interval '24 hours'),
          'oldest_due', min(next_attempt_at) filter (where status in ('pending', 'failed')))
        from public.webhook_deliveries),
      'sheets', (select jsonb_build_object(
          'pending', count(*) filter (where status = 'pending'),
          'retrying', count(*) filter (where status = 'failed'),
          'exhausted_24h', count(*) filter (where status = 'exhausted'
                                             and updated_at > now() - interval '24 hours'),
          'succeeded_24h', count(*) filter (where status = 'succeeded'
                                             and updated_at > now() - interval '24 hours'),
          'oldest_due', min(next_attempt_at) filter (where status in ('pending', 'failed')))
        from public.sheets_sync_log),
      'apps', (select jsonb_build_object(
          'pending', count(*) filter (where status in ('pending', 'running')),
          'retrying', count(*) filter (where status = 'failed'),
          'exhausted_24h', count(*) filter (where status = 'exhausted'
                                             and updated_at > now() - interval '24 hours'),
          'succeeded_24h', count(*) filter (where status = 'succeeded'
                                             and updated_at > now() - interval '24 hours'),
          'oldest_due', min(next_attempt_at) filter (where status in ('pending', 'failed')))
        from public.connector_jobs)),
    'failing_endpoints', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.failures desc) from (
        select we.id as endpoint_id, we.kind, f.title as form_title, w.name as workspace_name,
               w.id as workspace_id, count(*) as failures,
               left((array_agg(d.last_error order by d.updated_at desc))[1], 200) as last_error
          from public.webhook_deliveries d
          join public.webhook_endpoints we on we.id = d.endpoint_id
          join public.forms f on f.id = we.form_id
          join public.workspaces w on w.id = f.workspace_id
         where d.status in ('failed', 'exhausted') and d.updated_at > now() - interval '24 hours'
         group by we.id, we.kind, f.title, w.name, w.id
         order by count(*) desc limit 10) x), '[]'::jsonb),
    'scheduler', v_scheduler || jsonb_build_object('jobs', v_jobs),
    'alerts', coalesce((
      select jsonb_agg(jsonb_build_object('kind', a.kind, 'severity', a.severity,
                                          'message', a.message, 'first_seen_at', a.first_seen_at,
                                          'last_seen_at', a.last_seen_at, 'seen', a.seen_count,
                                          'notified_at', a.notified_at)
                       order by a.first_seen_at desc)
        from private.ops_alerts a where a.resolved_at is null), '[]'::jsonb),
    'restore_tests', coalesce((
      select jsonb_agg(jsonb_build_object('tested_at', t.tested_at, 'backup_time', t.backup_time,
                                          'restored_to', t.restored_to, 'checks', t.checks,
                                          'evidence_url', t.evidence_url, 'succeeded', t.succeeded)
                       order by t.tested_at desc)
        from (select * from private.restore_tests order by tested_at desc limit 5) t), '[]'::jsonb)
  );
end;
$$;

/** Records a restore drill (ADM-077): what was restored where, what was
 * checked, and whether it worked. */
create function public.admin_record_restore_test(
  p_backup_time timestamptz,
  p_restored_to text,
  p_checks text,
  p_evidence_url text,
  p_succeeded boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_staff uuid := private.check_staff('ops.record');
  v_id bigint;
begin
  if v_staff is null then return private.denial(); end if;
  if char_length(btrim(coalesce(p_restored_to, ''))) < 2
     or char_length(btrim(coalesce(p_checks, ''))) < 5
     or (nullif(btrim(p_evidence_url), '') is not null and p_evidence_url !~ '^https://') then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  insert into private.restore_tests (backup_time, restored_to, checks, evidence_url, succeeded,
                                     recorded_by)
  values (p_backup_time, btrim(p_restored_to), btrim(p_checks), nullif(btrim(p_evidence_url), ''),
          p_succeeded, v_staff)
  returning id into v_id;
  perform private.log_admin_action(v_staff, 'ops.restore_test_recorded', 'succeeded', null,
    'restore_test', v_id::text, null, null,
    jsonb_build_object('succeeded', p_succeeded, 'restored_to', btrim(p_restored_to)));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Scheduling (the checks in the database; the alert emails in the app)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron')
     and exists (select 1 from cron.job where jobname = 'formcraft-webhooks') then
    perform cron.schedule('formcraft-ops-checks', '*/5 * * * *', $j$select public.ops_run_checks()$j$);
    perform cron.schedule('formcraft-ops-alerts', '*/5 * * * *',
      $j$select public.call_cron_endpoint('/api/cron/ops')$j$);
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
  perform cron.schedule('formcraft-ops-checks', '*/5 * * * *',
    $j$select public.ops_run_checks()$j$);
  perform cron.schedule('formcraft-ops-alerts', '*/5 * * * *',
    $j$select public.call_cron_endpoint('/api/cron/ops')$j$);
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
    'formcraft-payments', 'formcraft-ops-checks', 'formcraft-ops-alerts'
  ] loop
    if exists (select 1 from cron.job where jobname = v_job) then
      perform cron.unschedule(v_job);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------

revoke all on all tables in schema private from public, anon, authenticated, service_role;
revoke all on all functions in schema private from public, anon, authenticated, service_role;
alter table private.restore_tests enable row level security;
alter table private.ops_alerts enable row level security;

revoke all on function public.schedule_background_jobs(text, text) from public, anon, authenticated, service_role;
revoke all on function public.unschedule_background_jobs() from public, anon, authenticated, service_role;

revoke all on function public.admin_usage_overview() from public, anon;
revoke all on function public.admin_form_inventory(text, text, integer, integer) from public, anon;
revoke all on function public.admin_resource_usage(text, integer) from public, anon;
revoke all on function public.admin_ops_health() from public, anon;
revoke all on function public.admin_record_restore_test(timestamptz, text, text, text, boolean) from public, anon;
grant execute on function public.admin_usage_overview() to authenticated;
grant execute on function public.admin_form_inventory(text, text, integer, integer) to authenticated;
grant execute on function public.admin_resource_usage(text, integer) to authenticated;
grant execute on function public.admin_ops_health() to authenticated;
grant execute on function public.admin_record_restore_test(timestamptz, text, text, text, boolean) to authenticated;

-- The alert job: secret key only.
revoke all on function public.ops_run_checks() from public, anon, authenticated;
revoke all on function public.ops_set_alert(text, text, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.ops_alerts_to_notify() from public, anon, authenticated;
revoke all on function public.ops_mark_notified(bigint[]) from public, anon, authenticated;
revoke all on function public.ops_alert_recipients() from public, anon, authenticated;
grant execute on function public.ops_run_checks() to service_role;
grant execute on function public.ops_set_alert(text, text, text, jsonb, boolean) to service_role;
grant execute on function public.ops_alerts_to_notify() to service_role;
grant execute on function public.ops_mark_notified(bigint[]) to service_role;
grant execute on function public.ops_alert_recipients() to service_role;
