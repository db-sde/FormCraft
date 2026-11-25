-- Super Admin, Phase 3 (docs/super-admin-design.md §3.10): one gateway
-- for every AI call. Before a call the database decides, in one statement,
-- whether it may run: AI switched on, the feature on, today's platform
-- spend under the ceiling, and a credit left on the workspace's plan
-- (taken atomically). After the call it records tokens and cost from the
-- API's own usage figures. Prompts and replies are never stored.
--
-- Settings (model, limits, the switch, the ceiling) change only through an
-- approved request. Pausing AI is the one thing a single owner or admin can
-- do alone (it only makes things safer), and owners are told when it happens.

-- ---------------------------------------------------------------------------
-- 1. Prices, settings, usage
-- ---------------------------------------------------------------------------

/** Prices in US dollars per million tokens, by the date they apply from.
 * Cost in micro-dollars is then tokens × price. Fallback models are here
 * too: a refused request can be served by one of them, at its own price. */
create table private.ai_prices (
  model text not null check (model ~ '^claude-[a-z0-9-]{1,60}$'),
  effective_from timestamptz not null default now(),
  input_usd_per_mtok numeric(10, 4) not null check (input_usd_per_mtok >= 0),
  output_usd_per_mtok numeric(10, 4) not null check (output_usd_per_mtok >= 0),
  cache_read_usd_per_mtok numeric(10, 4) not null check (cache_read_usd_per_mtok >= 0),
  cache_write_usd_per_mtok numeric(10, 4) not null check (cache_write_usd_per_mtok >= 0),
  primary key (model, effective_from)
);

insert into private.ai_prices (
  model, effective_from, input_usd_per_mtok, output_usd_per_mtok,
  cache_read_usd_per_mtok, cache_write_usd_per_mtok
) values
  -- Models a setting may choose (kept equal to ALLOWED_MODELS in code).
  ('claude-opus-5-5', '2026-01-01', 4, 20, 0.20, 5),
  ('claude-sonnet-5-5', '2026-01-01', 2, 10, 0.10, 2.50),
  ('claude-haiku-5-5', '2026-01-01', 0.10, 0.50, 0.01, 0.125),
  -- Server-side fallback targets.
  ('claude-opus-5', '2026-01-01', 5, 25, 0.50, 6.25),
  ('claude-opus-4-8', '2026-01-01', 5, 25, 0.50, 6.25),
  ('claude-sonnet-5', '2026-01-01', 2, 10, 0.20, 2.50);

/** One row per feature, plus '*' for the whole platform (the switch, the
 * default model and the daily ceiling). A feature with no model of its
 * own uses the default. */
create table private.ai_settings (
  feature text primary key check (feature ~ '^(\*|[a-z][a-z_]{1,40})$'),
  enabled boolean not null default true,
  model text check (model in ('claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5')),
  max_tokens integer check (max_tokens between 256 and 32000),
  daily_ceiling_usd numeric(10, 2) check (daily_ceiling_usd > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references private.staff_members (user_id) on delete set null,
  check (feature = '*' or daily_ceiling_usd is null),
  check (feature <> '*' or model is not null)
);

insert into private.ai_settings (feature, model, daily_ceiling_usd) values
  ('*', 'claude-opus-5-5', 50);
insert into private.ai_settings (feature) values
  ('form_generate'), ('form_edit'), ('logic_rule'), ('form_review'),
  ('response_analysis'), ('response_summary'), ('follow_up');

/** One row per model call. No prompt, no reply: only what it cost. */
create table private.ai_usage (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  workspace_id uuid references public.workspaces (id) on delete set null,
  feature text not null,
  requested_model text not null,
  served_model text,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  cost_micros bigint not null default 0,
  latency_ms integer,
  outcome text not null check (outcome in ('ok', 'refusal', 'max_tokens', 'error')),
  error_kind text check (char_length(error_kind) <= 60),
  request_id text check (char_length(request_id) <= 120)
);
create index ai_usage_at_idx on private.ai_usage (at);
create index ai_usage_workspace_at_idx on private.ai_usage (workspace_id, at);

/** Running total per UTC day, so the ceiling check reads one row. */
create table private.ai_daily_cost (
  day date primary key,
  cost_micros bigint not null default 0,
  calls integer not null default 0
);

alter table private.ai_prices enable row level security;
alter table private.ai_settings enable row level security;
alter table private.ai_usage enable row level security;
alter table private.ai_daily_cost enable row level security;

-- ---------------------------------------------------------------------------
-- 2. The gateway's two calls (secret key only)
-- ---------------------------------------------------------------------------

/** May this call run, and with which model? Takes one credit when it may.
 * Codes: off, feature_off, unknown_feature, ceiling, credits. */
create function public.ai_begin(
  p_workspace_id uuid,
  p_feature text,
  p_credit_limit bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_global private.ai_settings;
  v_feature private.ai_settings;
  v_spent_micros bigint;
  v_credits bigint;
begin
  select * into v_global from private.ai_settings where feature = '*';
  if not found or not v_global.enabled then
    return jsonb_build_object('ok', false, 'code', 'off');
  end if;
  select * into v_feature from private.ai_settings where feature = p_feature and feature <> '*';
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_feature');
  end if;
  if not v_feature.enabled then
    return jsonb_build_object('ok', false, 'code', 'feature_off');
  end if;

  select cost_micros into v_spent_micros
    from private.ai_daily_cost where day = (now() at time zone 'UTC')::date;
  if v_spent_micros >= v_global.daily_ceiling_usd * 1000000 then
    perform private.raise_alert(
      'ai_ceiling_reached', 'critical',
      format('AI spend today ($%s) reached the daily ceiling of $%s. AI is paused for '
             'every customer until midnight UTC, or until the ceiling is raised.',
             round(v_spent_micros / 1000000.0, 2), v_global.daily_ceiling_usd),
      jsonb_build_object('spent_micros', v_spent_micros,
                         'ceiling_usd', v_global.daily_ceiling_usd));
    return jsonb_build_object('ok', false, 'code', 'ceiling');
  end if;
  if exists (select 1 from private.ops_alerts
              where kind = 'ai_ceiling_reached' and resolved_at is null) then
    perform private.resolve_alert('ai_ceiling_reached');
  end if;

  v_credits := public.spend_usage(p_workspace_id, 'ai_credits', p_credit_limit, 1);
  if v_credits is null then
    return jsonb_build_object('ok', false, 'code', 'credits');
  end if;
  return jsonb_build_object(
    'ok', true,
    'model', coalesce(v_feature.model, v_global.model),
    'max_tokens', v_feature.max_tokens,
    'credits_used', v_credits);
end;
$$;

/** The price row for a model at a moment. */
create function private.ai_price(p_model text, p_at timestamptz)
returns private.ai_prices
language sql
stable
security definer
set search_path = ''
as $$
  select p.* from private.ai_prices p
   where p.model = p_model and p.effective_from <= p_at
   order by p.effective_from desc
   limit 1;
$$;

/** Records one call. `p_attempts` is the API's usage per attempt: a
 * refused attempt and the fallback that served it are each priced at their
 * own model's rate. An attempt on a model with no price is charged at the
 * requested model's price (or the dearest known one) and raises a warning,
 * so costs are never under-counted silently. */
create function public.ai_record_usage(
  p_workspace_id uuid,
  p_feature text,
  p_requested_model text,
  p_served_model text,
  p_attempts jsonb,
  p_latency_ms integer,
  p_outcome text,
  p_error_kind text default null,
  p_request_id text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_now timestamptz := now();
  v_attempt jsonb;
  v_model text;
  v_price private.ai_prices;
  v_in bigint; v_out bigint; v_read bigint; v_write bigint;
  v_tin bigint := 0; v_tout bigint := 0; v_tread bigint := 0; v_twrite bigint := 0;
  v_cost numeric := 0;
  v_missing text[] := array[]::text[];
begin
  if not exists (select 1 from private.ai_settings where feature = p_feature and feature <> '*') then
    raise exception 'unknown AI feature %', p_feature using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_attempts, '[]'::jsonb)) <> 'array' then
    raise exception 'attempts must be an array' using errcode = '22023';
  end if;
  for v_attempt in select value from jsonb_array_elements(coalesce(p_attempts, '[]'::jsonb)) loop
    v_model := coalesce(nullif(v_attempt ->> 'model', ''), p_requested_model);
    v_in := greatest(coalesce((v_attempt ->> 'input_tokens')::bigint, 0), 0);
    v_out := greatest(coalesce((v_attempt ->> 'output_tokens')::bigint, 0), 0);
    v_read := greatest(coalesce((v_attempt ->> 'cache_read_input_tokens')::bigint, 0), 0);
    v_write := greatest(coalesce((v_attempt ->> 'cache_creation_input_tokens')::bigint, 0), 0);
    v_price := private.ai_price(v_model, v_now);
    if v_price.model is null then
      v_missing := v_missing || v_model;
      v_price := private.ai_price(p_requested_model, v_now);
      if v_price.model is null then
        select p.* into v_price from private.ai_prices p
         order by p.output_usd_per_mtok desc, p.input_usd_per_mtok desc limit 1;
      end if;
    end if;
    v_cost := v_cost
      + v_in * v_price.input_usd_per_mtok
      + v_out * v_price.output_usd_per_mtok
      + v_read * v_price.cache_read_usd_per_mtok
      + v_write * v_price.cache_write_usd_per_mtok;
    v_tin := v_tin + v_in; v_tout := v_tout + v_out;
    v_tread := v_tread + v_read; v_twrite := v_twrite + v_write;
  end loop;

  insert into private.ai_usage (
    at, workspace_id, feature, requested_model, served_model, input_tokens, output_tokens,
    cache_read_tokens, cache_write_tokens, cost_micros, latency_ms, outcome, error_kind,
    request_id
  ) values (
    v_now, p_workspace_id, p_feature, left(p_requested_model, 80), left(p_served_model, 80),
    v_tin, v_tout, v_tread, v_twrite, round(v_cost)::bigint, p_latency_ms, p_outcome,
    left(p_error_kind, 60), left(p_request_id, 120)
  );
  insert into private.ai_daily_cost as d (day, cost_micros, calls)
  values ((v_now at time zone 'UTC')::date, round(v_cost)::bigint, 1)
  on conflict (day) do update
    set cost_micros = d.cost_micros + excluded.cost_micros, calls = d.calls + 1;

  if cardinality(v_missing) > 0 then
    perform private.raise_alert(
      'ai_price_missing', 'warning',
      format('No price is set for %s, so its calls are charged at another model''s '
             'rate. Add its price to private.ai_prices.', array_to_string(v_missing, ', ')),
      jsonb_build_object('models', to_jsonb(v_missing)));
  end if;
  return round(v_cost)::bigint;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Approval rules and the admin functions (ADM-064/065/068/069)
-- ---------------------------------------------------------------------------

create or replace function private.change_rules(p_action text)
returns table (request_permission text, approve_permission text, approver_roles text[])
language sql
immutable
set search_path = ''
as $$
  select r.request_permission, r.approve_permission, r.approver_roles from (values
    ('staff.add', 'staff.manage', 'approvals.decide', array['owner', 'admin']),
    ('staff.set_role', 'staff.manage', 'approvals.decide', array['owner', 'admin']),
    ('staff.disable', 'staff.manage', 'approvals.decide', array['owner', 'admin']),
    ('workspace.status', 'customers.status', 'approvals.decide', array['owner', 'admin']),
    ('workspace.plan', 'plans.change', 'approvals.decide', array['owner', 'admin', 'billing']),
    ('plan.update', 'plans.change', 'approvals.decide', array['owner', 'admin']),
    ('ai.settings', 'ai.settings', 'approvals.decide', array['owner', 'admin'])
  ) r(action, request_permission, approve_permission, approver_roles)
  where r.action = p_action;
$$;

/** Settings, spend and usage for the AI page. */
create function public.admin_ai_overview()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '15s'
as $$
declare
  v_staff uuid := private.check_staff('ops.read');
  v_today date := (now() at time zone 'UTC')::date;
  v_since timestamptz := now() - interval '30 days';
begin
  if v_staff is null then return private.denial(); end if;
  perform private.log_admin_action(v_staff, 'ai.viewed', 'succeeded');
  return jsonb_build_object(
    'ok', true,
    'today', v_today,
    'settings', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'feature', s.feature, 'enabled', s.enabled, 'model', s.model,
        'max_tokens', s.max_tokens, 'daily_ceiling_usd', s.daily_ceiling_usd,
        'updated_at', s.updated_at) order by s.feature = '*' desc, s.feature), '[]'::jsonb)
      from private.ai_settings s),
    'prices', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'model', p.model, 'input', p.input_usd_per_mtok, 'output', p.output_usd_per_mtok,
        'cache_read', p.cache_read_usd_per_mtok, 'cache_write', p.cache_write_usd_per_mtok,
        'effective_from', p.effective_from) order by p.model), '[]'::jsonb)
      from (select distinct on (model) * from private.ai_prices
             where effective_from <= now() order by model, effective_from desc) p),
    'spent_today_micros', coalesce(
      (select cost_micros from private.ai_daily_cost where day = v_today), 0),
    'by_day', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day', d.day, 'cost_micros', coalesce(c.cost_micros, 0), 'calls', coalesce(c.calls, 0))
        order by d.day), '[]'::jsonb)
      from generate_series(v_today - 29, v_today, interval '1 day') g(dd)
      cross join lateral (select g.dd::date as day) d
      left join private.ai_daily_cost c on c.day = d.day),
    'by_feature', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'feature', f.feature, 'calls', f.calls, 'cost_micros', f.cost,
        'refusals', f.refusals, 'errors', f.errors, 'truncated', f.truncated,
        'avg_latency_ms', f.avg_latency) order by f.cost desc), '[]'::jsonb)
      from (select feature, count(*) as calls, sum(cost_micros) as cost,
                   count(*) filter (where outcome = 'refusal') as refusals,
                   count(*) filter (where outcome = 'error') as errors,
                   count(*) filter (where outcome = 'max_tokens') as truncated,
                   round(avg(latency_ms)) as avg_latency
              from private.ai_usage where at >= v_since group by feature) f),
    'by_model', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'model', m.model, 'calls', m.calls, 'cost_micros', m.cost) order by m.cost desc),
        '[]'::jsonb)
      from (select coalesce(served_model, requested_model) as model, count(*) as calls,
                   sum(cost_micros) as cost
              from private.ai_usage where at >= v_since group by 1) m),
    'top_workspaces', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.workspace_id, 'name', w.name, 'slug', w.slug, 'calls', t.calls,
        'cost_micros', t.cost) order by t.cost desc), '[]'::jsonb)
      from (select workspace_id, count(*) as calls, sum(cost_micros) as cost
              from private.ai_usage
             where at >= v_since and workspace_id is not null
             group by workspace_id order by sum(cost_micros) desc limit 25) t
      join public.workspaces w on w.id = t.workspace_id)
  );
end;
$$;

/** Checks a requested settings change. Null when it's fine, otherwise
 * what's wrong. */
create function private.ai_settings_problem(p_feature text, p_payload jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_key text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or p_payload = '{}'::jsonb then
    return 'nothing to change';
  end if;
  if not exists (select 1 from private.ai_settings where feature = p_feature) then
    return 'unknown feature';
  end if;
  for v_key in select jsonb_object_keys(p_payload) loop
    if v_key not in ('enabled', 'model', 'max_tokens', 'daily_ceiling_usd') then
      return format('unknown setting %s', v_key);
    end if;
  end loop;
  if p_payload ? 'enabled' and jsonb_typeof(p_payload -> 'enabled') <> 'boolean' then
    return 'enabled must be true or false';
  end if;
  if p_payload ? 'model' then
    if jsonb_typeof(p_payload -> 'model') = 'null' then
      if p_feature = '*' then return 'the platform needs a default model'; end if;
    elsif jsonb_typeof(p_payload -> 'model') <> 'string'
       or p_payload ->> 'model' not in ('claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5')
       or private.ai_price(p_payload ->> 'model', now()) is null then
      return 'that model is not allowed';
    end if;
  end if;
  if p_payload ? 'max_tokens' and jsonb_typeof(p_payload -> 'max_tokens') <> 'null'
     and (jsonb_typeof(p_payload -> 'max_tokens') <> 'number'
          or (p_payload ->> 'max_tokens')::numeric not between 256 and 32000
          or (p_payload ->> 'max_tokens')::numeric <> trunc((p_payload ->> 'max_tokens')::numeric)) then
    return 'max tokens must be a whole number from 256 to 32000';
  end if;
  if p_payload ? 'daily_ceiling_usd' then
    if p_feature <> '*' then return 'the ceiling is a platform setting'; end if;
    if jsonb_typeof(p_payload -> 'daily_ceiling_usd') <> 'number'
       or (p_payload ->> 'daily_ceiling_usd')::numeric not between 1 and 100000 then
      return 'the ceiling must be between $1 and $100,000 a day';
    end if;
  end if;
  return null;
end;
$$;

/** Carries out an approved settings change (model, limits, switch, ceiling). */
create function public.admin_apply_ai_change(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_staff uuid;
  v_req private.change_requests;
  v_before private.ai_settings;
  v_after private.ai_settings;
  v_problem text;
begin
  v_staff := private.check_staff('ai.settings', true);
  if v_staff is null then return private.denial(); end if;
  select * into v_req from private.change_requests where id = p_request_id;
  if not found or v_req.action <> 'ai.settings' then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  v_problem := private.ai_settings_problem(v_req.target_id, v_req.payload);
  if v_problem is not null then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'why', v_problem);
  end if;
  if private.consume_approval(p_request_id, v_req.action, v_req.target_id, v_req.payload)
     is null then
    perform private.log_admin_action(
      v_staff, 'ai.settings', 'denied', 'no approved request', 'ai_setting',
      v_req.target_id, null, p_request_id, '{}'::jsonb);
    return jsonb_build_object('ok', false, 'code', 'approval_required');
  end if;

  select * into v_before from private.ai_settings where feature = v_req.target_id for update;
  update private.ai_settings s set
    enabled = case when v_req.payload ? 'enabled'
                   then (v_req.payload ->> 'enabled')::boolean else s.enabled end,
    model = case when v_req.payload ? 'model' then v_req.payload ->> 'model' else s.model end,
    max_tokens = case when v_req.payload ? 'max_tokens'
                      then (v_req.payload ->> 'max_tokens')::integer else s.max_tokens end,
    daily_ceiling_usd = case when v_req.payload ? 'daily_ceiling_usd'
                             then (v_req.payload ->> 'daily_ceiling_usd')::numeric
                             else s.daily_ceiling_usd end,
    updated_at = now(), updated_by = v_staff
  where s.feature = v_req.target_id
  returning * into v_after;

  if v_after.feature = '*' and v_after.enabled then
    perform private.resolve_alert('ai_paused');
  end if;
  perform private.log_admin_action(
    v_staff, 'ai.settings', 'succeeded', v_req.reason, 'ai_setting', v_req.target_id, null,
    p_request_id, jsonb_build_object('before', to_jsonb(v_before) - 'updated_by' - 'updated_at',
                                     'after', to_jsonb(v_after) - 'updated_by' - 'updated_at'));
  return jsonb_build_object('ok', true);
end;
$$;

/** Turns AI off for everyone at once (an incident, runaway spend). One
 * person may do this; turning it back on needs an approved request. */
create function public.admin_ai_pause(p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_staff uuid := private.check_staff('ai.settings', true);
  v_name text;
begin
  if v_staff is null then return private.denial(); end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  update private.ai_settings set enabled = false, updated_at = now(), updated_by = v_staff
   where feature = '*';
  select display_name into v_name from private.staff_members where user_id = v_staff;
  perform private.raise_alert(
    'ai_paused', 'warning',
    format('%s paused AI for every customer: %s', coalesce(v_name, 'A staff member'),
           btrim(p_reason)),
    jsonb_build_object('staff_id', v_staff));
  perform private.log_admin_action(
    v_staff, 'ai.paused', 'succeeded', btrim(p_reason), 'ai_setting', '*', null, null,
    '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------

revoke all on function public.ai_begin(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.ai_begin(uuid, text, bigint) to service_role;
revoke all on function public.ai_record_usage(uuid, text, text, text, jsonb, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.ai_record_usage(uuid, text, text, text, jsonb, integer, text, text, text)
  to service_role;

revoke all on function private.ai_price(text, timestamptz) from public, anon, authenticated;
revoke all on function private.ai_settings_problem(text, jsonb) from public, anon, authenticated;

revoke all on function public.admin_ai_overview() from public, anon;
revoke all on function public.admin_apply_ai_change(uuid) from public, anon;
revoke all on function public.admin_ai_pause(text) from public, anon;
grant execute on function public.admin_ai_overview() to authenticated;
grant execute on function public.admin_apply_ai_change(uuid) to authenticated;
grant execute on function public.admin_ai_pause(text) to authenticated;
