-- Master spec Phase 4 (2026-10-31): in-form A/B variants (F-29) and
-- confidential 360 feedback plus scheduled reports (F-30).

-- 1. Variant tests. A form's published version can carry variants (other
-- wording, question order or layout — in the schema, so they're versioned
-- with it); a test sends a share of new visitors to one variant. Product
-- owner's rules (2026-10-31): a winner needs 95% confidence and at least
-- 100 starts per arm; the split is fixed while the test runs (pause to
-- change it); pausing sends everyone new to the original while people
-- already assigned keep their variant; adopting a winner never publishes.
create table public.variant_tests (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete cascade,
  variant_id text not null check (variant_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  name text not null check (length(btrim(name)) between 1 and 120),
  split integer not null check (split between 1 and 99),
  status text not null default 'running' check (status in ('running', 'paused', 'ended')),
  -- 'original' or the variant id, once a winner is adopted.
  winner text check (winner is null or winner ~ '^[A-Za-z0-9_-]{1,64}$'),
  created_by uuid references public.profiles (id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index variant_tests_one_open_idx
  on public.variant_tests (form_id) where status <> 'ended';

create function public.variant_tests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.form_id <> old.form_id or new.variant_id <> old.variant_id then
      raise exception 'A test''s form and variant can''t change.';
    end if;
    if old.status = 'ended' then
      raise exception 'An ended test can''t change.';
    end if;
    if new.split <> old.split and old.status <> 'paused' then
      raise exception 'Pause the test to change its split.';
    end if;
    if new.status = 'ended' and new.ended_at is null then
      new.ended_at := now();
    end if;
  end if;
  return new;
end;
$$;
create trigger variant_tests_guard
  before insert or update on public.variant_tests
  for each row execute function public.variant_tests_guard();

alter table public.responses
  add column variant_test_id uuid references public.variant_tests (id) on delete set null,
  add column variant text check (variant is null or variant ~ '^[A-Za-z0-9_-]{1,64}$');
create index responses_variant_test_idx on public.responses (variant_test_id, variant)
  where variant_test_id is not null;

-- 2. Confidential feedback (360). Product owner (2026-10-31): groups of
-- raters with fewer than the threshold (3 by default) are never shown on
-- their own, and nobody sees individual ratings — only averages. Once a
-- confidential form has responses it can't be made ordinary again, and
-- its threshold can't go down.
alter table public.forms add column confidential jsonb
  check (confidential is null or (
    jsonb_typeof(confidential) = 'object'
    and (confidential ->> 'threshold')::int between 2 and 50
  ));

-- Security definer: it must see every response, including the ones the
-- policy below hides from the person making the change.
create function public.forms_confidential_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.confidential is not null
    and (new.confidential is null
      or (new.confidential ->> 'threshold')::int < (old.confidential ->> 'threshold')::int)
    and exists (select 1 from public.responses r where r.form_id = old.id)
  then
    raise exception 'A confidential form with responses stays confidential.';
  end if;
  return new;
end;
$$;
revoke all on function public.forms_confidential_guard() from public, anon, authenticated;
create trigger forms_confidential_guard
  before update of confidential on public.forms
  for each row execute function public.forms_confidential_guard();

-- Individual responses of a confidential form are hidden from every
-- signed-in user (owners included); reports are computed on the server.
create function public.response_is_confidential(p_form_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.forms f where f.id = p_form_id and f.confidential is not null
  );
$$;
revoke all on function public.response_is_confidential(uuid) from public, anon;
grant execute on function public.response_is_confidential(uuid) to authenticated, service_role;

create policy "responses: confidential forms hide individuals" on public.responses
  as restrictive for select to authenticated
  using (not (select public.response_is_confidential(form_id)));
create policy "answers: confidential forms hide individuals" on public.answers
  as restrictive for select to authenticated
  using (not exists (
    select 1 from public.responses r
    where r.id = response_id and (select public.response_is_confidential(r.form_id))
  ));

-- 3. Scheduled reports: the digest can be daily or weekly.
alter table public.notification_digests
  add column frequency text not null default 'daily' check (frequency in ('daily', 'weekly'));

-- Row-level security for variant tests: members read; publishers write.
alter table public.variant_tests enable row level security;
create policy "mfa: second factor when enrolled" on public.variant_tests as restrictive
  for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
create policy "variant_tests: members read" on public.variant_tests
  for select using (exists (
    select 1 from public.forms f where f.id = form_id and public.is_workspace_member(f.workspace_id)
  ));
create policy "variant_tests: publishers write" on public.variant_tests
  for all using (exists (
    select 1 from public.forms f where f.id = form_id
      and public.can_edit_workspace(f.workspace_id)
      and public.has_permission(f.workspace_id, 'publish')
  )) with check (exists (
    select 1 from public.forms f where f.id = form_id
      and public.can_edit_workspace(f.workspace_id)
      and public.has_permission(f.workspace_id, 'publish')
  ));
revoke all on public.variant_tests from anon;
grant select, insert, update on public.variant_tests to authenticated;
grant select, insert, update, delete on public.variant_tests to service_role;
