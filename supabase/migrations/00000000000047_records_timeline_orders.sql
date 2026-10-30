-- Master spec Phase 2 (2026-10-30): the per-response timeline (F-31),
-- the records view (F-03), orders from the product block (F-04) and the
-- import report (F-05).

-- 1. Timeline events the existing logs don't already hold: emails sent,
-- replays, and changes to a response's record (status, assignee,
-- comments). Webhook, Sheets and payment attempts keep living in their
-- own tables; the timeline reads them alongside these. Written by the
-- server only; read by whoever may read the response. Deleted with the
-- response (retention and privacy requests included).
create table public.response_events (
  id bigint generated always as identity primary key,
  response_id uuid not null references public.responses (id) on delete cascade,
  kind text not null check (kind in (
    'email_owner', 'email_respondent', 'replay', 'status_changed', 'assigned', 'commented'
  )),
  outcome text not null default 'ok' check (outcome in ('ok', 'failed', 'skipped')),
  -- Non-sensitive detail only (a status, an error message, a target);
  -- never answers or tokens.
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index response_events_response_idx on public.response_events (response_id, created_at);

-- 2. The records view: a review status (the product owner's set, 2026-10-30)
-- and an assignee on each response, and internal comments respondents
-- never see. Kept apart from `status`, the response's own lifecycle.
alter table public.responses
  add column review_status text not null default 'new'
    check (review_status in ('new', 'in_progress', 'done')),
  add column assignee_id uuid references public.profiles (id) on delete set null;
create index responses_review_idx on public.responses (form_id, review_status);
create index responses_assignee_idx on public.responses (assignee_id) where assignee_id is not null;

create table public.response_comments (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.responses (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index response_comments_response_idx on public.response_comments (response_id, created_at);

-- 3. The order a response placed with a product block: prices and the
-- total as the server worked them out from the published form, in the
-- form's currency's minor units. Payment (final phase) reads it.
create table public.response_orders (
  response_id uuid primary key references public.responses (id) on delete cascade,
  form_id uuid not null references public.forms (id) on delete cascade,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  lines jsonb not null check (jsonb_typeof(lines) = 'array'),
  total_amount bigint not null check (total_amount >= 0),
  created_at timestamptz not null default now()
);

-- 4. What an import brought over and what it couldn't (F-05), shown in
-- the builder until the creator dismisses it.
alter table public.forms add column import_report jsonb
  check (import_report is null or jsonb_typeof(import_report) = 'object');

-- Row-level security: read with the right to read responses; every
-- write goes through the server after its own permission check.
alter table public.response_events enable row level security;
alter table public.response_comments enable row level security;
alter table public.response_orders enable row level security;
create policy "mfa: second factor when enrolled" on public.response_events as restrictive
  for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
create policy "mfa: second factor when enrolled" on public.response_comments as restrictive
  for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
create policy "mfa: second factor when enrolled" on public.response_orders as restrictive
  for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

create policy "response_events: permitted members read" on public.response_events
  for select using (exists (
    select 1 from public.responses r join public.forms f on f.id = r.form_id
    where r.id = response_id and public.has_permission(f.workspace_id, 'view_responses')
  ));
create policy "response_comments: permitted members read" on public.response_comments
  for select using (exists (
    select 1 from public.responses r join public.forms f on f.id = r.form_id
    where r.id = response_id and public.has_permission(f.workspace_id, 'view_responses')
  ));
create policy "response_orders: permitted members read" on public.response_orders
  for select using (exists (
    select 1 from public.forms f
    where f.id = form_id and public.has_permission(f.workspace_id, 'view_responses')
  ));

revoke all on public.response_events, public.response_comments, public.response_orders from anon;
grant select on public.response_events, public.response_comments, public.response_orders to authenticated;
grant select, insert, update, delete on public.response_events, public.response_comments, public.response_orders
  to service_role;
