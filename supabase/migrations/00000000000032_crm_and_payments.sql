-- HubSpot (PRD P2.15) and Stripe payments (P2.17).

-- ---------------------------------------------------------------------
-- credentials: encrypted (AES-256-GCM with APP_SECRET), server only
-- ---------------------------------------------------------------------
create table public.integration_credentials (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null check (provider in ('hubspot', 'stripe')),
  -- { iv, authTag, ciphertext } — never the raw token or key.
  encrypted jsonb not null,
  -- What can be shown: "pat-na1-…1234", "sk_test_…abcd", the account name.
  label text,
  status text not null default 'ok' check (status in ('ok', 'invalid')),
  created_at timestamptz not null default now(),
  unique (workspace_id, provider)
);
-- No policies: only the server reads or writes credentials.
alter table public.integration_credentials enable row level security;

-- A safe summary members can see (no secrets).
create function public.integration_status(p_workspace_id uuid)
returns table (provider text, label text, status text, created_at timestamptz)
language sql
security definer
stable
set search_path = public
as $$
  select c.provider, c.label, c.status, c.created_at
  from public.integration_credentials c
  where c.workspace_id = p_workspace_id and public.is_workspace_member(p_workspace_id);
$$;
grant execute on function public.integration_status(uuid) to authenticated;

-- HubSpot deliveries ride the webhook queue.
alter table public.webhook_endpoints drop constraint webhook_endpoints_kind_check;
alter table public.webhook_endpoints
  add constraint webhook_endpoints_kind_check
  check (kind in ('webhook', 'slack', 'zapier', 'make', 'hubspot'));

-- ---------------------------------------------------------------------
-- payments
-- ---------------------------------------------------------------------
create table public.payments (
  response_id uuid primary key references public.responses (id) on delete cascade,
  form_id uuid not null references public.forms (id) on delete cascade,
  -- Smallest currency unit (cents), computed on the server.
  amount bigint not null check (amount > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  -- Only ever moved by the server: a Stripe webhook or a server-side
  -- check of the Checkout Session — never because a browser said so.
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'expired', 'canceled')),
  checkout_session_id text unique,
  livemode boolean not null default false,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_form_id_idx on public.payments (form_id);

alter table public.payments enable row level security;
create policy "payments: members read via form" on public.payments
  for select using (exists (
    select 1 from public.forms f
    where f.id = form_id and public.is_workspace_member(f.workspace_id)
  ));
grant select on public.payments to authenticated;

-- A form's payment (P2.17): { amount (major units) | amountVariableId,
-- currency, description }. Null = no payment. The amount charged is
-- computed on the server from this and the response — never sent by a
-- browser.
alter table public.forms
  add column payment_config jsonb check (payment_config is null or jsonb_typeof(payment_config) = 'object');
