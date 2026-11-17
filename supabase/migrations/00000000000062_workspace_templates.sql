-- Custom form templates (feature 61, 2026-11-14).
--
-- A whole form saved as a template a workspace can start new forms from:
-- its questions, logic, design and settings that live in the schema, and
-- nothing else. Responses, integrations, webhooks, lookups, payment
-- settings and keys are in their own tables and are never copied. The
-- schema is a snapshot: editing the form later doesn't change the
-- template, and editing the template doesn't change forms made from it.
--
-- Who sees what: a "private" template only its creator; a "workspace"
-- one every member. Editors and up create them (a form needs edit rights
-- anyway). The creator, or an owner / admin, may change or delete one.

create table public.workspace_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 120),
  description text check (description is null or char_length(description) <= 500),
  category text not null default 'Custom'
    check (length(btrim(category)) between 1 and 40),
  visibility text not null default 'workspace'
    check (visibility in ('private', 'workspace')),
  schema jsonb not null check (jsonb_typeof(schema) = 'object'),
  -- Which form it was saved from, if that form still exists.
  source_form_id uuid references public.forms (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workspace_templates_workspace_idx
  on public.workspace_templates (workspace_id, created_at desc);
create trigger workspace_templates_set_updated_at
  before update on public.workspace_templates
  for each row execute function public.set_updated_at();

alter table public.workspace_templates enable row level security;
create policy "mfa: second factor when enrolled" on public.workspace_templates as restrictive
  for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

create policy "workspace_templates: members read shared, creators their own"
  on public.workspace_templates for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (visibility = 'workspace' or created_by = (select auth.uid()))
  );
create policy "workspace_templates: editors create their own"
  on public.workspace_templates for insert to authenticated
  with check (
    public.can_edit_workspace(workspace_id) and created_by = (select auth.uid())
  );
-- The workspace and creator never change (with check, below).
create policy "workspace_templates: creator or admin changes"
  on public.workspace_templates for update to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (created_by = (select auth.uid()) or public.can_admin_workspace(workspace_id))
  )
  with check (
    public.is_workspace_member(workspace_id)
    and (created_by = (select auth.uid()) or public.can_admin_workspace(workspace_id))
  );
create policy "workspace_templates: creator or admin deletes"
  on public.workspace_templates for delete to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (created_by = (select auth.uid()) or public.can_admin_workspace(workspace_id))
  );

-- Moving a template to another workspace, or claiming someone else's,
-- isn't an edit any role may make.
create or replace function public.workspace_templates_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id <> old.workspace_id or new.created_by <> old.created_by then
    raise exception 'a template''s workspace and creator are fixed'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger workspace_templates_guard
  before update on public.workspace_templates
  for each row execute function public.workspace_templates_guard();
revoke execute on function public.workspace_templates_guard() from public, anon, authenticated;

revoke all on public.workspace_templates from anon, authenticated;
grant select, insert, delete on public.workspace_templates to authenticated;
grant update (title, description, category, visibility, schema)
  on public.workspace_templates to authenticated;
grant all on public.workspace_templates to service_role;
