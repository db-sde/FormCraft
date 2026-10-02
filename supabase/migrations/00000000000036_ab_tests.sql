-- A/B tests (P3.9): a form's link (arm A) splits its traffic with a
-- second published form (arm B) in the same workspace. Each visitor is
-- assigned once, by a hash of a first-party visitor cookie, so they see
-- the same arm every time. Responses keep their own form and version;
-- experiment_id only says which test served them.

update public.plans
  set entitlements = entitlements || jsonb_build_object('ab_testing', id in ('business', 'enterprise'));

create table public.experiments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- Arm A: the form whose link is shared.
  form_id uuid not null references public.forms (id) on delete cascade,
  -- Arm B.
  variant_form_id uuid not null references public.forms (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  -- Percent of new visitors sent to B.
  split integer not null default 50 check (split between 1 and 99),
  status text not null default 'running' check (status in ('running', 'stopped')),
  winner text check (winner in ('a', 'b')),
  created_by uuid references public.profiles (id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  check (form_id <> variant_form_id),
  check ((status = 'running') = (ended_at is null)),
  check (winner is null or status = 'stopped')
);
-- One running test per shared link.
create unique index experiments_one_running_idx
  on public.experiments (form_id) where status = 'running';
create index experiments_variant_idx on public.experiments (variant_form_id);

-- Both arms belong to the experiment's workspace.
create function public.experiments_check_forms()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.forms f
      where f.id in (new.form_id, new.variant_form_id)
        and f.workspace_id = new.workspace_id) <> 2 then
    raise exception 'Both forms must be in the experiment''s workspace.';
  end if;
  if old is not null and (new.form_id, new.variant_form_id, new.workspace_id)
       is distinct from (old.form_id, old.variant_form_id, old.workspace_id) then
    raise exception 'An experiment''s forms can''t change.';
  end if;
  -- A stopped test stays stopped.
  if old is not null and old.status = 'stopped' and new.status = 'running' then
    raise exception 'A stopped experiment can''t restart.';
  end if;
  return new;
end;
$$;
create trigger experiments_check_forms
  before insert or update on public.experiments
  for each row execute function public.experiments_check_forms();

alter table public.experiments enable row level security;
create policy "experiments: members read" on public.experiments
  for select using (public.is_workspace_member(workspace_id));
create policy "experiments: publishers create" on public.experiments
  for insert with check (
    public.can_edit_workspace(workspace_id)
    and public.has_permission(workspace_id, 'publish')
  );
create policy "experiments: publishers update" on public.experiments
  for update using (
    public.can_edit_workspace(workspace_id)
    and public.has_permission(workspace_id, 'publish')
  );
grant select, insert, update on public.experiments to authenticated;

alter table public.responses
  add column experiment_id uuid references public.experiments (id) on delete set null;
create index responses_experiment_idx on public.responses (experiment_id)
  where experiment_id is not null;

-- Starts and completions per arm (by the response's form). security
-- invoker: only responses the caller may read are counted.
create function public.experiment_stats(target_experiment_id uuid)
returns table (form_id uuid, started integer, completed integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.form_id, count(*)::integer,
         (count(*) filter (where r.status = 'completed'))::integer
  from public.responses r
  where r.experiment_id = target_experiment_id
    and not r.is_preview
    and not r.spam_suspected
  group by r.form_id
$$;
grant execute on function public.experiment_stats(uuid) to authenticated;
