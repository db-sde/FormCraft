-- The API to the developer spec (26 Nov 2026, item 5), plan rows for
-- checkout, and the forms:write permission for archiving by API.
--
-- * Every plan has the API. Limits are per workspace across all its keys:
--   a token bucket (refilled at the plan's per-minute rate, as big as its
--   burst) and a daily count that resets at 00:00 UTC. Taken atomically
--   in the database, so every Vercel instance sees the same numbers.
-- * Usage is kept by the hour for the Settings → API graphs.
-- * Plans gain INR prices (Razorpay checkout) and the api_burst limit.

-- ---------------------------------------------------------------------------
-- 1. Plans: INR prices, api_burst (scripts/plan-sql.ts)
-- ---------------------------------------------------------------------------

alter table public.plans
  add column monthly_inr numeric(10, 2) check (monthly_inr >= 0),
  add column annual_inr numeric(10, 2) check (annual_inr >= 0);

create or replace function private.entitlement_kinds()
returns table (key text, kind text)
language sql
immutable
set search_path = ''
as $$
  select * from (values
    ('responses_per_month', 'limit'), ('members', 'limit'), ('upload_mb', 'limit'),
    ('storage_mb', 'limit'), ('custom_domains', 'limit'), ('ai_credits_per_month', 'limit'),
    ('emails_per_month', 'limit'), ('address_lookups_per_month', 'limit'), ('recording_seconds', 'limit'),
    ('booking_types', 'limit'), ('api_requests_per_minute', 'limit'), ('api_burst', 'limit'),
    ('api_requests_per_day', 'limit'), ('api_keys', 'limit'), ('popup_embeds', 'feature'),
    ('multilingual', 'feature'), ('scheduling', 'feature'), ('slack', 'feature'),
    ('payments', 'feature'), ('api_access', 'feature'), ('remove_branding', 'feature'),
    ('custom_fonts', 'feature'), ('custom_seo', 'feature'), ('email_templates', 'feature'),
    ('confirmation_emails', 'feature'), ('tracking_pixels', 'feature'), ('calendar_sync', 'feature'),
    ('business_apps', 'feature'), ('partial_responses', 'feature'), ('advanced_analytics', 'feature'),
    ('pdf_documents', 'feature'), ('ai_form_tools', 'feature'), ('folders', 'feature'),
    ('advanced_pixels', 'feature'), ('team_hosts', 'feature'), ('crm', 'feature'),
    ('ai_insights', 'feature'), ('advanced_reports', 'feature'), ('response_workflow', 'feature'),
    ('submission_editing', 'feature'), ('team_notifications', 'feature'), ('block_library', 'feature'),
    ('advanced_logic', 'feature'), ('data_lookups', 'feature'), ('dynamic_themes', 'feature'),
    ('embed_controls', 'feature'), ('ab_testing', 'feature'), ('email_otp', 'feature'),
    ('multiple_workspaces', 'feature'), ('granular_permissions', 'feature'), ('audit_log', 'feature'),
    ('auto_deletion', 'feature'), ('sso', 'feature'), ('scim', 'feature')
  ) e(key, kind);
$$;

insert into public.plans (id, name, sort_order, entitlements, monthly_usd, annual_usd, monthly_inr, annual_inr, is_public, tagline)
values
  ('free', 'Free', 0, '{"responses_per_month":5000,"members":1,"upload_mb":10,"storage_mb":1000,"custom_domains":0,"ai_credits_per_month":0,"emails_per_month":500,"address_lookups_per_month":0,"recording_seconds":60,"booking_types":1,"api_requests_per_minute":60,"api_burst":100,"api_requests_per_day":5000,"api_keys":2,"popup_embeds":true,"multilingual":true,"scheduling":true,"slack":true,"payments":true,"api_access":true,"remove_branding":false,"custom_fonts":false,"custom_seo":false,"email_templates":false,"confirmation_emails":false,"tracking_pixels":false,"calendar_sync":false,"business_apps":false,"partial_responses":false,"advanced_analytics":false,"pdf_documents":false,"ai_form_tools":false,"folders":false,"advanced_pixels":false,"team_hosts":false,"crm":false,"ai_insights":false,"advanced_reports":false,"response_workflow":false,"submission_editing":false,"team_notifications":false,"block_library":false,"advanced_logic":false,"data_lookups":false,"dynamic_themes":false,"embed_controls":false,"ab_testing":false,"email_otp":false,"multiple_workspaces":false,"granular_permissions":false,"audit_log":false,"auto_deletion":false,"sso":false,"scim":false}'::jsonb, 0, 0, 0, 0, true, 'Individuals, students, testing'),
  ('starter', 'Starter', 1, '{"responses_per_month":10000,"members":3,"upload_mb":50,"storage_mb":10000,"custom_domains":1,"ai_credits_per_month":100,"emails_per_month":2000,"address_lookups_per_month":500,"recording_seconds":180,"booking_types":null,"api_requests_per_minute":150,"api_burst":1000,"api_requests_per_day":50000,"api_keys":5,"popup_embeds":true,"multilingual":true,"scheduling":true,"slack":true,"payments":true,"api_access":true,"remove_branding":true,"custom_fonts":true,"custom_seo":true,"email_templates":true,"confirmation_emails":true,"tracking_pixels":true,"calendar_sync":true,"business_apps":true,"partial_responses":true,"advanced_analytics":true,"pdf_documents":true,"ai_form_tools":true,"folders":true,"advanced_pixels":false,"team_hosts":false,"crm":false,"ai_insights":false,"advanced_reports":false,"response_workflow":false,"submission_editing":false,"team_notifications":false,"block_library":false,"advanced_logic":false,"data_lookups":false,"dynamic_themes":false,"embed_controls":false,"ab_testing":false,"email_otp":false,"multiple_workspaces":false,"granular_permissions":false,"audit_log":false,"auto_deletion":false,"sso":false,"scim":false}'::jsonb, 19, 15, 1599, 1299, true, 'Creators, freelancers, small businesses'),
  ('pro', 'Pro', 2, '{"responses_per_month":25000,"members":10,"upload_mb":100,"storage_mb":50000,"custom_domains":3,"ai_credits_per_month":1000,"emails_per_month":10000,"address_lookups_per_month":2000,"recording_seconds":600,"booking_types":null,"api_requests_per_minute":300,"api_burst":10000,"api_requests_per_day":250000,"api_keys":25,"popup_embeds":true,"multilingual":true,"scheduling":true,"slack":true,"payments":true,"api_access":true,"remove_branding":true,"custom_fonts":true,"custom_seo":true,"email_templates":true,"confirmation_emails":true,"tracking_pixels":true,"calendar_sync":true,"business_apps":true,"partial_responses":true,"advanced_analytics":true,"pdf_documents":true,"ai_form_tools":true,"folders":true,"advanced_pixels":true,"team_hosts":true,"crm":true,"ai_insights":true,"advanced_reports":true,"response_workflow":true,"submission_editing":true,"team_notifications":true,"block_library":true,"advanced_logic":true,"data_lookups":true,"dynamic_themes":true,"embed_controls":true,"ab_testing":true,"email_otp":true,"multiple_workspaces":true,"granular_permissions":true,"audit_log":false,"auto_deletion":false,"sso":false,"scim":false}'::jsonb, 49, 39, 4199, 3299, true, 'Growing teams, marketers, agencies'),
  ('business', 'Business', 3, '{"responses_per_month":50000,"members":null,"upload_mb":500,"storage_mb":200000,"custom_domains":null,"ai_credits_per_month":2000,"emails_per_month":25000,"address_lookups_per_month":2500,"recording_seconds":600,"booking_types":null,"api_requests_per_minute":1000,"api_burst":50000,"api_requests_per_day":null,"api_keys":null,"popup_embeds":true,"multilingual":true,"scheduling":true,"slack":true,"payments":true,"api_access":true,"remove_branding":true,"custom_fonts":true,"custom_seo":true,"email_templates":true,"confirmation_emails":true,"tracking_pixels":true,"calendar_sync":true,"business_apps":true,"partial_responses":true,"advanced_analytics":true,"pdf_documents":true,"ai_form_tools":true,"folders":true,"advanced_pixels":true,"team_hosts":true,"crm":true,"ai_insights":true,"advanced_reports":true,"response_workflow":true,"submission_editing":true,"team_notifications":true,"block_library":true,"advanced_logic":true,"data_lookups":true,"dynamic_themes":true,"embed_controls":true,"ab_testing":true,"email_otp":true,"multiple_workspaces":true,"granular_permissions":true,"audit_log":true,"auto_deletion":true,"sso":true,"scim":true}'::jsonb, 89, 69, 7599, 5899, true, 'Larger teams, IT-managed companies'),
  ('enterprise', 'Enterprise', 4, '{"responses_per_month":null,"members":null,"upload_mb":500,"storage_mb":null,"custom_domains":null,"ai_credits_per_month":5000,"emails_per_month":100000,"address_lookups_per_month":10000,"recording_seconds":600,"booking_types":null,"api_requests_per_minute":1000,"api_burst":50000,"api_requests_per_day":null,"api_keys":null,"popup_embeds":true,"multilingual":true,"scheduling":true,"slack":true,"payments":true,"api_access":true,"remove_branding":true,"custom_fonts":true,"custom_seo":true,"email_templates":true,"confirmation_emails":true,"tracking_pixels":true,"calendar_sync":true,"business_apps":true,"partial_responses":true,"advanced_analytics":true,"pdf_documents":true,"ai_form_tools":true,"folders":true,"advanced_pixels":true,"team_hosts":true,"crm":true,"ai_insights":true,"advanced_reports":true,"response_workflow":true,"submission_editing":true,"team_notifications":true,"block_library":true,"advanced_logic":true,"data_lookups":true,"dynamic_themes":true,"embed_controls":true,"ab_testing":true,"email_otp":true,"multiple_workspaces":true,"granular_permissions":true,"audit_log":true,"auto_deletion":true,"sso":true,"scim":true}'::jsonb, null, null, null, null, false, null)
on conflict (id) do update set
  name = excluded.name,
  sort_order = excluded.sort_order,
  entitlements = excluded.entitlements,
  monthly_usd = excluded.monthly_usd,
  annual_usd = excluded.annual_usd,
  monthly_inr = excluded.monthly_inr,
  annual_inr = excluded.annual_inr,
  is_public = excluded.is_public,
  tagline = excluded.tagline;

drop function public.public_plans();
/** The listed plans for the pricing page (no sign-in needed). */
create function public.public_plans()
returns table (
  id text, name text, sort_order integer, monthly_usd numeric, annual_usd numeric,
  monthly_inr numeric, annual_inr numeric, tagline text, entitlements jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.sort_order, p.monthly_usd, p.annual_usd, p.monthly_inr,
         p.annual_inr, p.tagline, p.entitlements
    from public.plans p
   where p.is_public
   order by p.sort_order;
$$;
revoke all on function public.public_plans() from public;
grant execute on function public.public_plans() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. forms:write (archive and restore through the API)
-- ---------------------------------------------------------------------------

alter table public.api_keys drop constraint if exists api_keys_scopes_check;
alter table public.api_keys add constraint api_keys_scopes_check
  check (scopes <@ array['forms:read', 'forms:write', 'responses:read', 'hooks:write']::text[]);

-- ---------------------------------------------------------------------------
-- 3. Rate limits: a token bucket and a daily count per workspace
-- ---------------------------------------------------------------------------

create table private.api_rate_buckets (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  tokens double precision not null,
  refilled_at timestamptz not null,
  day date not null,
  day_count integer not null default 0,
  last_limited_at timestamptz,
  last_limited_scope text check (last_limited_scope in ('minute', 'day')),
  day_cap_notified_on date
);
alter table private.api_rate_buckets enable row level security;

create table private.api_usage_hourly (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  hour timestamptz not null,
  requests integer not null default 0,
  limited integer not null default 0,
  primary key (workspace_id, hour)
);
alter table private.api_usage_hourly enable row level security;

/** Takes one API request for a workspace. A null per-minute rate or
 * daily cap means none. Returns {allowed, scope (when refused),
 * retry_after, limit, remaining, reset, daily_remaining, first_day_cap}:
 * `reset` is seconds until the bucket is full again, `first_day_cap` is
 * true the first time today the daily cap refused a request (the owner is
 * emailed once). */
create function public.api_take(
  p_workspace_id uuid,
  p_per_minute integer,
  p_burst integer,
  p_per_day integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '3s'
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_today date := (clock_timestamp() at time zone 'UTC')::date;
  v_burst double precision := coalesce(p_burst, p_per_minute, 1000000);
  v_rate double precision := coalesce(p_per_minute, 1000000) / 60.0;
  r private.api_rate_buckets;
  v_tokens double precision;
  v_count integer;
  v_scope text;
  v_retry integer := 0;
  v_first boolean := false;
begin
  insert into private.api_rate_buckets (workspace_id, tokens, refilled_at, day)
  values (p_workspace_id, v_burst, v_now, v_today)
  on conflict (workspace_id) do nothing;
  select * into r from private.api_rate_buckets
   where workspace_id = p_workspace_id for update;

  v_tokens := least(v_burst,
    r.tokens + greatest(0, extract(epoch from v_now - r.refilled_at)) * v_rate);
  v_count := case when r.day = v_today then r.day_count else 0 end;

  if p_per_day is not null and v_count >= p_per_day then
    v_scope := 'day';
    v_retry := ceil(extract(epoch from
      ((v_today + 1)::timestamp at time zone 'UTC') - v_now))::integer;
  elsif p_per_minute is not null and v_tokens < 1 then
    v_scope := 'minute';
    v_retry := greatest(1, ceil((1 - v_tokens) / v_rate)::integer);
  else
    v_tokens := v_tokens - 1;
    v_count := v_count + 1;
  end if;

  if v_scope = 'day' and r.day_cap_notified_on is distinct from v_today then
    v_first := true;
  end if;

  update private.api_rate_buckets set
    tokens = v_tokens,
    refilled_at = v_now,
    day = v_today,
    day_count = v_count,
    last_limited_at = case when v_scope is null then last_limited_at else v_now end,
    last_limited_scope = coalesce(v_scope, last_limited_scope),
    day_cap_notified_on = case when v_first then v_today else day_cap_notified_on end
  where workspace_id = p_workspace_id;

  insert into private.api_usage_hourly as u (workspace_id, hour, requests, limited)
  values (p_workspace_id, date_trunc('hour', v_now),
          case when v_scope is null then 1 else 0 end,
          case when v_scope is null then 0 else 1 end)
  on conflict (workspace_id, hour) do update set
    requests = u.requests + excluded.requests,
    limited = u.limited + excluded.limited;

  return jsonb_build_object(
    'allowed', v_scope is null,
    'scope', v_scope,
    'retry_after', v_retry,
    'limit', p_per_minute,
    'remaining', floor(greatest(v_tokens, 0)),
    'reset', ceil(greatest(v_burst - v_tokens, 0) / v_rate),
    'daily_remaining', case when p_per_day is null then null
                            else greatest(p_per_day - v_count, 0) end,
    'first_day_cap', v_first);
end;
$$;
revoke all on function public.api_take(uuid, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.api_take(uuid, integer, integer, integer) to service_role;

/** API usage for Settings → API (owners and admins): requests by hour
 * for the last 24 hours, by day for the last 30, and the last refusal. */
create function public.api_usage_summary(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_admin_workspace(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'denied');
  end if;
  return jsonb_build_object(
    'ok', true,
    'now', now(),
    'hourly', coalesce((
      select jsonb_agg(jsonb_build_object('hour', h.hour, 'requests', h.requests,
                                          'limited', h.limited) order by h.hour)
        from private.api_usage_hourly h
       where h.workspace_id = p_workspace_id and h.hour > now() - interval '24 hours'),
      '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'requests', d.requests,
                                          'limited', d.limited) order by d.day)
        from (select (h.hour at time zone 'UTC')::date as day, sum(h.requests) requests,
                     sum(h.limited) limited
                from private.api_usage_hourly h
               where h.workspace_id = p_workspace_id
                 and h.hour > now() - interval '30 days'
               group by 1) d),
      '[]'::jsonb),
    'last_limited_at', (select b.last_limited_at from private.api_rate_buckets b
                         where b.workspace_id = p_workspace_id),
    'last_limited_scope', (select b.last_limited_scope from private.api_rate_buckets b
                            where b.workspace_id = p_workspace_id));
end;
$$;
revoke all on function public.api_usage_summary(uuid) from public, anon;
grant execute on function public.api_usage_summary(uuid) to authenticated;

-- Hourly usage older than 35 days isn't shown anywhere: the daily
-- retention job prunes it.
create function public.ops_prune_api_usage()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  delete from private.api_usage_hourly where hour < now() - interval '35 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.ops_prune_api_usage() from public, anon, authenticated;
grant execute on function public.ops_prune_api_usage() to service_role;
