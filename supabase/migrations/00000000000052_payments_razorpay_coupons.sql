-- Master spec Phase 7 (2026-11-03): payments enhancement (F-22) and
-- Razorpay / UPI (F-35), one workstream. Product owner (2026-11-03):
-- Razorpay in INR only; one coupon per payment (percent or amount off,
-- optional expiry and usage limit, counted when paid); refunds are made
-- in the provider's dashboard and recorded here from its webhooks; an
-- unpaid response is kept, marked unpaid, and can be paid later. No tax
-- calculation: receipts aren't tax invoices.

-- 1. Razorpay credentials (key id, key secret, webhook secret), stored
-- encrypted like Stripe's.
alter table public.integration_credentials drop constraint integration_credentials_provider_check;
alter table public.integration_credentials add constraint integration_credentials_provider_check
  check (provider in ('hubspot', 'stripe', 'razorpay'));

-- 2. Coupons, per form. Codes are stored upper-case; one per payment.
create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9_-]{3,40}$'),
  -- percent: 1–100 off; amount: this many minor units off.
  kind text not null check (kind in ('percent', 'amount')),
  percent_off integer check (percent_off between 1 and 100),
  amount_off bigint check (amount_off > 0),
  expires_at timestamptz,
  max_uses integer check (max_uses > 0),
  -- Paid payments that used it (kept by record_payment_paid).
  uses integer not null default 0 check (uses >= 0),
  active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (form_id, code),
  check ((kind = 'percent') = (percent_off is not null)),
  check ((kind = 'amount') = (amount_off is not null))
);

alter table public.coupons enable row level security;
create policy "mfa: second factor when enrolled" on public.coupons as restrictive
  for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
create policy "coupons: members read" on public.coupons
  for select using (exists (
    select 1 from public.forms f where f.id = form_id and public.is_workspace_member(f.workspace_id)
  ));
create policy "coupons: editors write" on public.coupons
  for all using (exists (
    select 1 from public.forms f where f.id = form_id and public.can_edit_workspace(f.workspace_id)
  )) with check (exists (
    select 1 from public.forms f where f.id = form_id and public.can_edit_workspace(f.workspace_id)
  ));
revoke all on public.coupons from anon;
grant select, insert, delete on public.coupons to authenticated;
-- Uses are counted by the server only.
grant update (code, kind, percent_off, amount_off, expires_at, max_uses, active)
  on public.coupons to authenticated;
grant select, insert, update, delete on public.coupons to service_role;

-- 3. A response's payment, now for either provider (or a coupon that
-- makes it free), with what was discounted and what was refunded.
alter table public.payments drop constraint payments_amount_check;
alter table public.payments add constraint payments_amount_check check (amount >= 0);
alter table public.payments drop constraint payments_status_check;
alter table public.payments add constraint payments_status_check
  check (status in ('pending', 'paid', 'failed', 'expired', 'canceled', 'refunded'));
alter table public.payments
  add column provider text not null default 'stripe'
    check (provider in ('stripe', 'razorpay', 'coupon')),
  add column subtotal bigint check (subtotal >= 0),
  add column discount bigint not null default 0 check (discount >= 0),
  add column coupon_id uuid references public.coupons (id) on delete set null,
  add column coupon_code text,
  add column provider_payment_id text,
  add column refunded_amount bigint not null default 0 check (refunded_amount >= 0);

-- 4. Each attempt to pay — a Razorpay order, a Stripe Checkout Session,
-- or a free-by-coupon confirmation. The provider's id is unique, so a
-- webhook for any attempt (even a superseded one) finds its response.
create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.responses (id) on delete cascade,
  form_id uuid not null references public.forms (id) on delete cascade,
  provider text not null check (provider in ('stripe', 'razorpay', 'coupon')),
  provider_ref text not null unique,
  -- A Checkout Session's page, reused while it's open.
  checkout_url text,
  subtotal bigint not null check (subtotal >= 0),
  discount bigint not null default 0 check (discount >= 0),
  amount bigint not null check (amount >= 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  coupon_id uuid references public.coupons (id) on delete set null,
  coupon_code text,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'expired')),
  provider_payment_id text,
  error text,
  livemode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payment_attempts_response_idx on public.payment_attempts (response_id, created_at);
create index payment_attempts_payment_id_idx on public.payment_attempts (provider, provider_payment_id);

alter table public.payment_attempts enable row level security;
create policy "mfa: second factor when enrolled" on public.payment_attempts as restrictive
  for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
create policy "payment_attempts: members read via form" on public.payment_attempts
  for select using (exists (
    select 1 from public.forms f where f.id = form_id and public.is_workspace_member(f.workspace_id)
  ));
revoke all on public.payment_attempts from anon;
grant select on public.payment_attempts to authenticated;
grant select, insert, update, delete on public.payment_attempts to service_role;

-- 5. Paid never goes back (spec §6.1 #3: duplicate or out-of-order
-- webhooks leave exactly one correct terminal state). A paid payment can
-- only become refunded; its amount is fixed once paid.
create function public.payments_state_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'paid' and new.status not in ('paid', 'refunded') then
    raise exception 'a paid payment can''t become %', new.status using errcode = 'check_violation';
  end if;
  if old.status = 'refunded' and new.status <> 'refunded' then
    raise exception 'a refunded payment can''t become %', new.status using errcode = 'check_violation';
  end if;
  if old.status in ('paid', 'refunded') and (new.amount <> old.amount or new.provider <> old.provider) then
    raise exception 'a paid payment''s amount is fixed' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger payments_state_guard before update on public.payments
  for each row execute function public.payments_state_guard();

create function public.payment_attempts_state_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'paid' and new.status <> 'paid' then
    raise exception 'a paid attempt can''t become %', new.status using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger payment_attempts_state_guard before update on public.payment_attempts
  for each row execute function public.payment_attempts_state_guard();

-- 6. Records an attempt as paid, atomically: the attempt, the response's
-- payment (once — a second paid attempt for an already-paid response is
-- reported as a duplicate, to refund), and the coupon's use count.
-- Returns 'paid', 'already' (this attempt was already recorded),
-- 'duplicate' or 'not_found'.
create function public.record_payment_paid(p_provider_ref text, p_provider_payment_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.payment_attempts;
  p public.payments;
begin
  select * into a from public.payment_attempts where provider_ref = p_provider_ref for update;
  if not found then return 'not_found'; end if;
  if a.status = 'paid' then return 'already'; end if;
  update public.payment_attempts
    set status = 'paid', provider_payment_id = coalesce(p_provider_payment_id, provider_payment_id),
        error = null, updated_at = now()
    where id = a.id;
  select * into p from public.payments where response_id = a.response_id for update;
  if found and p.status in ('paid', 'refunded') then
    return 'duplicate';
  end if;
  insert into public.payments as t (
    response_id, form_id, amount, currency, status, provider, subtotal, discount,
    coupon_id, coupon_code, provider_payment_id, checkout_session_id, livemode, paid_at, updated_at
  ) values (
    a.response_id, a.form_id, a.amount, a.currency, 'paid', a.provider, a.subtotal, a.discount,
    a.coupon_id, a.coupon_code, p_provider_payment_id,
    case when a.provider = 'stripe' then a.provider_ref end, a.livemode, now(), now()
  )
  on conflict (response_id) do update set
    amount = excluded.amount, currency = excluded.currency, status = 'paid',
    provider = excluded.provider, subtotal = excluded.subtotal, discount = excluded.discount,
    coupon_id = excluded.coupon_id, coupon_code = excluded.coupon_code,
    provider_payment_id = excluded.provider_payment_id,
    checkout_session_id = coalesce(excluded.checkout_session_id, t.checkout_session_id),
    livemode = excluded.livemode, paid_at = now(), updated_at = now();
  if a.coupon_id is not null then
    update public.coupons set uses = uses + 1 where id = a.coupon_id;
  end if;
  return 'paid';
end;
$$;
revoke all on function public.record_payment_paid(text, text) from public, anon, authenticated;
grant execute on function public.record_payment_paid(text, text) to service_role;

-- 7. Payment notes on the timeline (refunds, duplicates), and paid
-- receipts as a document kind.
alter table public.response_events drop constraint response_events_kind_check;
alter table public.response_events add constraint response_events_kind_check check (kind in (
  'email_owner', 'email_respondent', 'replay', 'status_changed', 'assigned', 'commented',
  'document_emailed', 'email_rule', 'booking', 'payment'
));
alter table public.form_documents drop constraint form_documents_kind_check;
alter table public.form_documents add constraint form_documents_kind_check
  check (kind in ('summary', 'order', 'registration', 'certificate', 'receipt'));
