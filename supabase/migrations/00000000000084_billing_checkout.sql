-- Checkout for FormCraft's own plans (26 Nov 2026): Stripe in US dollars
-- (cards worldwide) and Razorpay in rupees (cards and UPI autopay in
-- India), both as subscriptions.
--
-- The plan a workspace is on changes only when a provider says so: a
-- signed webhook, or the server asking the provider about a checkout it
-- started. Never from the browser. Each provider event is applied once.
-- A cancelled or ended subscription moves the workspace to Free at the end
-- of what was paid for; its data stays. A plan staff set by hand (say
-- Enterprise on a contract) isn't touched by a subscription for another
-- plan ending.

create table public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null check (provider in ('stripe', 'razorpay')),
  provider_subscription_id text not null check (char_length(provider_subscription_id) <= 120),
  provider_customer_id text check (char_length(provider_customer_id) <= 120),
  plan_id text not null references public.plans (id),
  billing_interval text not null check (billing_interval in ('month', 'year')),
  currency text not null check (currency in ('usd', 'inr')),
  status text not null check (status in ('pending', 'active', 'past_due', 'cancelled', 'ended')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_subscription_id)
);
create index billing_subscriptions_workspace on public.billing_subscriptions (workspace_id, updated_at desc);
alter table public.billing_subscriptions enable row level security;
create policy "billing_subscriptions: owners and admins read" on public.billing_subscriptions
  for select to authenticated using (public.can_admin_workspace(workspace_id));
revoke all on public.billing_subscriptions from anon, authenticated;
grant select on public.billing_subscriptions to authenticated;
grant all on public.billing_subscriptions to service_role;

create table private.billing_events (
  provider text not null,
  event_id text not null check (char_length(event_id) <= 200),
  type text not null,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);
alter table private.billing_events enable row level security;

-- Razorpay subscriptions need a plan object per price; made once each.
create table private.billing_provider_plans (
  provider text not null,
  plan_id text not null,
  billing_interval text not null,
  currency text not null,
  amount_minor integer not null,
  provider_plan_id text not null,
  created_at timestamptz not null default now(),
  primary key (provider, plan_id, billing_interval, currency, amount_minor)
);
alter table private.billing_provider_plans enable row level security;

/** Records a provider event once: true the first time, false after. */
create function public.billing_claim_event(p_provider text, p_event_id text, p_type text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.billing_events (provider, event_id, type)
  values (p_provider, p_event_id, left(p_type, 80));
  return true;
exception when unique_violation then
  return false;
end;
$$;

create function public.billing_provider_plan(
  p_provider text, p_plan_id text, p_interval text, p_currency text, p_amount integer
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select provider_plan_id from private.billing_provider_plans
   where provider = p_provider and plan_id = p_plan_id and billing_interval = p_interval
     and currency = p_currency and amount_minor = p_amount;
$$;

create function public.billing_remember_provider_plan(
  p_provider text, p_plan_id text, p_interval text, p_currency text, p_amount integer,
  p_provider_plan_id text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.billing_provider_plans
    (provider, plan_id, billing_interval, currency, amount_minor, provider_plan_id)
  values (p_provider, p_plan_id, p_interval, p_currency, p_amount, p_provider_plan_id)
  on conflict do nothing;
$$;

/**
 * Applies a provider's subscription state. Active (or past due, still in
 * its grace period) puts the workspace on the subscription's plan;
 * cancelled or ended moves it to Free unless staff have since put it on
 * another plan. Returns {plan_changed, from, to}.
 */
create function public.billing_apply_subscription(
  p_workspace_id uuid,
  p_provider text,
  p_subscription_id text,
  p_customer_id text,
  p_plan_id text,
  p_interval text,
  p_currency text,
  p_status text,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from text;
  v_to text;
begin
  if not exists (select 1 from public.plans where id = p_plan_id and is_public and id <> 'free') then
    raise exception 'not a paid plan: %', p_plan_id;
  end if;
  select plan_id into v_from from public.workspaces where id = p_workspace_id for update;
  if not found then
    raise exception 'no such workspace';
  end if;

  insert into public.billing_subscriptions as s
    (workspace_id, provider, provider_subscription_id, provider_customer_id, plan_id,
     billing_interval, currency, status, current_period_end, cancel_at_period_end)
  values (p_workspace_id, p_provider, p_subscription_id, p_customer_id, p_plan_id,
          p_interval, p_currency, p_status, p_current_period_end, coalesce(p_cancel_at_period_end, false))
  on conflict (provider, provider_subscription_id) do update set
    provider_customer_id = coalesce(excluded.provider_customer_id, s.provider_customer_id),
    plan_id = excluded.plan_id,
    billing_interval = excluded.billing_interval,
    status = excluded.status,
    current_period_end = coalesce(excluded.current_period_end, s.current_period_end),
    cancel_at_period_end = excluded.cancel_at_period_end,
    updated_at = now()
  where s.workspace_id = p_workspace_id;

  v_to := v_from;
  if p_status in ('active', 'past_due') then
    v_to := p_plan_id;
  elsif p_status in ('cancelled', 'ended') and v_from = p_plan_id
        and not exists (select 1 from public.billing_subscriptions o
                         where o.workspace_id = p_workspace_id
                           and o.provider_subscription_id <> p_subscription_id
                           and o.status in ('active', 'past_due')) then
    v_to := 'free';
  end if;
  if v_to is distinct from v_from then
    update public.workspaces set plan_id = v_to where id = p_workspace_id;
  end if;
  return jsonb_build_object('plan_changed', v_to is distinct from v_from, 'from', v_from, 'to', v_to);
end;
$$;

revoke all on function public.billing_claim_event(text, text, text) from public, anon, authenticated;
revoke all on function public.billing_provider_plan(text, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.billing_remember_provider_plan(text, text, text, text, integer, text) from public, anon, authenticated;
revoke all on function public.billing_apply_subscription(uuid, text, text, text, text, text, text, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.billing_claim_event(text, text, text) to service_role;
grant execute on function public.billing_provider_plan(text, text, text, text, integer) to service_role;
grant execute on function public.billing_remember_provider_plan(text, text, text, text, integer, text) to service_role;
grant execute on function public.billing_apply_subscription(uuid, text, text, text, text, text, text, text, timestamptz, boolean) to service_role;

/** Which FormCraft plan and interval a provider's plan object is for
 * (a Razorpay subscription changed to another plan keeps its old notes). */
create function public.billing_plan_for_provider_plan(p_provider text, p_provider_plan_id text)
returns table (plan_id text, billing_interval text)
language sql
stable
security definer
set search_path = ''
as $$
  select plan_id, billing_interval from private.billing_provider_plans
   where provider = p_provider and provider_plan_id = p_provider_plan_id
   limit 1;
$$;
revoke all on function public.billing_plan_for_provider_plan(text, text) from public, anon, authenticated;
grant execute on function public.billing_plan_for_provider_plan(text, text) to service_role;
