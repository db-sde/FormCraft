-- Forms domain: forms (stable identity) + form_versions (draft/published/
-- archived). Draft is mutable; published/archived are immutable once
-- created — enforced by trigger below, not just convention.

create type public.form_version_status as enum ('draft', 'published', 'archived');

create table public.forms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null,
  description text,
  slug text not null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, slug)
);

create index forms_workspace_id_idx on public.forms (workspace_id);

create table public.form_versions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete cascade,
  status public.form_version_status not null default 'draft',
  version_number integer not null,
  schema jsonb not null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (form_id, version_number)
);

create index form_versions_form_id_idx on public.form_versions (form_id, status);

-- exactly one draft per form
create unique index form_versions_one_draft_per_form
  on public.form_versions (form_id)
  where (status = 'draft');

-- exactly one published version per form at a time
create unique index form_versions_one_published_per_form
  on public.form_versions (form_id)
  where (status = 'published');

-- ---------------------------------------------------------------------
-- Immutability: once a form_versions row is published or archived, its
-- schema/status may only move draft -> published -> archived, never
-- backwards, and 'schema' may never change after leaving 'draft'.
-- ---------------------------------------------------------------------
create function public.enforce_form_version_immutability()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'draft' and new.status in ('draft', 'published') then
    -- allowed: keep editing draft, or publish it
    return new;
  end if;

  if old.status = 'published' and new.status = 'archived' then
    -- allowed: superseded by a republish, being archived
    if new.schema is distinct from old.schema then
      raise exception 'form_versions.schema is immutable once published (form_version %)', old.id;
    end if;
    return new;
  end if;

  if old.status = new.status and old.status in ('published', 'archived') then
    if new.schema is distinct from old.schema then
      raise exception 'form_versions.schema is immutable once published (form_version %)', old.id;
    end if;
    return new;
  end if;

  raise exception 'invalid form_version status transition: % -> % (form_version %)',
    old.status, new.status, old.id;
end;
$$;

create trigger form_versions_enforce_immutability
  before update on public.form_versions
  for each row execute function public.enforce_form_version_immutability();

create trigger form_versions_set_updated_at
  before update on public.form_versions
  for each row execute function public.set_updated_at();

create trigger forms_set_updated_at
  before update on public.forms
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.forms enable row level security;
alter table public.form_versions enable row level security;

create policy "forms: members can read" on public.forms
  for select using (public.is_workspace_member(workspace_id));

create policy "forms: members can insert" on public.forms
  for insert with check (public.is_workspace_member(workspace_id));

create policy "forms: members can update" on public.forms
  for update using (public.is_workspace_member(workspace_id));

create policy "forms: members can delete" on public.forms
  for delete using (public.is_workspace_member(workspace_id));

create policy "form_versions: members can read via form" on public.form_versions
  for select using (
    exists (
      select 1 from public.forms f
      where f.id = form_id and public.is_workspace_member(f.workspace_id)
    )
  );

create policy "form_versions: members can insert via form" on public.form_versions
  for insert with check (
    exists (
      select 1 from public.forms f
      where f.id = form_id and public.is_workspace_member(f.workspace_id)
    )
  );

create policy "form_versions: members can update via form" on public.form_versions
  for update using (
    exists (
      select 1 from public.forms f
      where f.id = form_id and public.is_workspace_member(f.workspace_id)
    )
  );

-- Public (anon) read of the currently published version, needed for the
-- respondent runtime. Scoped strictly to status = 'published' and to
-- forms that are not soft-deleted.
create policy "form_versions: anon can read published" on public.form_versions
  for select
  to anon
  using (
    status = 'published'
    and exists (
      select 1 from public.forms f
      where f.id = form_id and f.deleted_at is null
    )
  );

create policy "forms: anon can read non-deleted for slug resolution" on public.forms
  for select
  to anon
  using (deleted_at is null);
