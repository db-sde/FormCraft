-- Plans, entitlements and usage metering (PRD §7–8, Phase 2 Wave 0).
--
-- Limits and features live here as data, never in UI code, and aren't
-- tied to prices. A workspace is on one plan; `entitlement_overrides`
-- carries per-workspace exceptions (grandfathering, deals). Only the
-- service role and migrations can change either — a customer can't
-- grant themselves a plan through their own session.

create table public.plans (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{0,31}$'),
  name text not null,
  sort_order integer not null default 0,
  -- Keys documented in src/domains/billing/entitlements.ts; missing keys
  -- fall back to the code's Free defaults, null means unlimited.
  entitlements jsonb not null default '{}' check (jsonb_typeof(entitlements) = 'object')
);

alter table public.plans enable row level security;
create policy "plans: anyone signed in can read" on public.plans
  for select to authenticated using (true);
grant select on public.plans to authenticated;

insert into public.plans (id, name, sort_order, entitlements) values
  ('free', 'Free', 0, '{
    "responses_per_month": 1000, "members": 1, "upload_mb": 10, "storage_mb": 1000,
    "remove_branding": false, "custom_domains": 0, "custom_fonts": false,
    "confirmation_emails": false, "popup_embeds": false, "tracking_pixels": false,
    "slack": false, "crm": false, "payments": false, "scheduling": false,
    "multilingual": false, "ai_credits_per_month": 20, "api_access": false
  }'),
  ('pro', 'Pro', 1, '{
    "responses_per_month": 10000, "members": 1, "upload_mb": 50, "storage_mb": 10000,
    "remove_branding": true, "custom_domains": 0, "custom_fonts": true,
    "confirmation_emails": true, "popup_embeds": true, "tracking_pixels": true,
    "slack": false, "crm": false, "payments": false, "scheduling": true,
    "multilingual": true, "ai_credits_per_month": 200, "api_access": false
  }'),
  ('business', 'Business', 2, '{
    "responses_per_month": 50000, "members": 10, "upload_mb": 100, "storage_mb": 50000,
    "remove_branding": true, "custom_domains": 3, "custom_fonts": true,
    "confirmation_emails": true, "popup_embeds": true, "tracking_pixels": true,
    "slack": true, "crm": true, "payments": true, "scheduling": true,
    "multilingual": true, "ai_credits_per_month": 1000, "api_access": true
  }'),
  ('enterprise', 'Enterprise', 3, '{
    "responses_per_month": null, "members": null, "upload_mb": 500, "storage_mb": null,
    "remove_branding": true, "custom_domains": null, "custom_fonts": true,
    "confirmation_emails": true, "popup_embeds": true, "tracking_pixels": true,
    "slack": true, "crm": true, "payments": true, "scheduling": true,
    "multilingual": true, "ai_credits_per_month": 5000, "api_access": true
  }');

alter table public.workspaces
  add column plan_id text not null default 'free' references public.plans (id),
  add column entitlement_overrides jsonb not null default '{}'
    check (jsonb_typeof(entitlement_overrides) = 'object');

-- Every workspace that exists before plans keeps what it had: no
-- "Powered by" badge on forms that never showed one, and file questions
-- keep the 100 MB ceiling Phase 1 allowed.
update public.workspaces
  set entitlement_overrides = '{"remove_branding": true, "upload_mb": 100}';

-- Plan and overrides are set by the service role (admin script, future
-- billing) only. A user's own session — through RLS'd inserts/updates or
-- a security-definer RPC acting for them — can't change them.
create function public.protect_workspace_plan()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.plan_id := 'free';
      new.entitlement_overrides := '{}';
    else
      new.plan_id := old.plan_id;
      new.entitlement_overrides := old.entitlement_overrides;
    end if;
  end if;
  return new;
end;
$$;

create trigger workspaces_protect_plan
  before insert or update on public.workspaces
  for each row execute function public.protect_workspace_plan();

-- ---------------------------------------------------------------------
-- usage metering
-- ---------------------------------------------------------------------
create table public.usage_counters (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  metric text not null check (metric ~ '^[a-z][a-z0-9_]{0,39}$'),
  -- First day of the calendar month (UTC) the usage belongs to.
  period_start date not null,
  value bigint not null default 0,
  primary key (workspace_id, metric, period_start)
);

alter table public.usage_counters enable row level security;
create policy "usage_counters: members can read" on public.usage_counters
  for select using (public.is_workspace_member(workspace_id));
grant select on public.usage_counters to authenticated;

create function public.increment_usage(
  p_workspace_id uuid,
  p_metric text,
  p_amount bigint default 1
)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into public.usage_counters as u (workspace_id, metric, period_start, value)
  values (
    p_workspace_id,
    p_metric,
    date_trunc('month', now() at time zone 'utc')::date,
    p_amount
  )
  on conflict (workspace_id, metric, period_start)
    do update set value = u.value + excluded.value
  returning value;
$$;

-- Server-side only (AI credits etc.); completed responses are counted by
-- the trigger below.
revoke execute on function public.increment_usage(uuid, text, bigint) from public, anon, authenticated;

-- A response is counted once, when it first becomes completed (the state
-- machine makes that transition one-way). Counting never blocks it.
create function public.count_completed_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed'
     and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    perform public.increment_usage(f.workspace_id, 'completed_responses', 1)
    from public.forms f
    where f.id = new.form_id;
  end if;
  return new;
end;
$$;

create trigger responses_count_completed
  after insert or update of status on public.responses
  for each row execute function public.count_completed_response();

-- The current month starts with what was already completed before the
-- counter existed, so the first month's numbers aren't short.
insert into public.usage_counters (workspace_id, metric, period_start, value)
select f.workspace_id, 'completed_responses',
       date_trunc('month', now() at time zone 'utc')::date, count(*)
from public.responses r
join public.forms f on f.id = r.form_id
where r.status = 'completed'
  and r.completed_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
group by f.workspace_id
on conflict (workspace_id, metric, period_start)
  do update set value = public.usage_counters.value + excluded.value;
