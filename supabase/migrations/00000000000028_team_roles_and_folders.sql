-- Teams (PRD P2.19) and folders (P2.20).
--
-- Roles: owner (one per workspace, its creator), admin (manages members
-- and everything else, not ownership), editor (builds, publishes, reads
-- responses — what every member could do before), viewer (reads forms,
-- responses and analytics; changes nothing). Every write policy below
-- moves from "is a member" to "can edit"; reads stay "is a member".
--
-- New enum values can't be used in the transaction that adds them, so
-- this file compares roles as text.

alter type public.workspace_role add value if not exists 'admin';
alter type public.workspace_role add value if not exists 'viewer';

create function public.can_edit_workspace(target_workspace_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.role::text in ('owner', 'admin', 'editor')
  );
$$;

create function public.can_admin_workspace(target_workspace_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.role::text in ('owner', 'admin')
  );
$$;

-- ---------------------------------------------------------------------
-- forms and versions: editors write, members read
-- ---------------------------------------------------------------------
drop policy "forms: members can insert" on public.forms;
drop policy "forms: members can update" on public.forms;
drop policy "forms: members can delete" on public.forms;
create policy "forms: editors can insert" on public.forms
  for insert with check (public.can_edit_workspace(workspace_id));
create policy "forms: editors can update" on public.forms
  for update using (public.can_edit_workspace(workspace_id))
  with check (public.can_edit_workspace(workspace_id));
create policy "forms: editors can delete" on public.forms
  for delete using (public.can_edit_workspace(workspace_id));

drop policy "form_versions: members can insert via form" on public.form_versions;
drop policy "form_versions: members can update via form" on public.form_versions;
create policy "form_versions: editors can insert via form" on public.form_versions
  for insert with check (exists (
    select 1 from public.forms f
    where f.id = form_id and public.can_edit_workspace(f.workspace_id)
  ));
create policy "form_versions: editors can update via form" on public.form_versions
  for update using (exists (
    select 1 from public.forms f
    where f.id = form_id and public.can_edit_workspace(f.workspace_id)
  ));

-- ---------------------------------------------------------------------
-- responses: editors delete, members read
-- ---------------------------------------------------------------------
drop policy "responses: members can delete via form" on public.responses;
create policy "responses: editors can delete via form" on public.responses
  for delete using (exists (
    select 1 from public.forms f
    where f.id = form_id and public.can_edit_workspace(f.workspace_id)
  ));

-- ---------------------------------------------------------------------
-- integrations: editors manage, members read
-- ---------------------------------------------------------------------
drop policy "notification_settings: members manage via form" on public.notification_settings;
create policy "notification_settings: members read via form" on public.notification_settings
  for select using (exists (
    select 1 from public.forms f
    where f.id = form_id and public.is_workspace_member(f.workspace_id)
  ));
create policy "notification_settings: editors manage via form" on public.notification_settings
  for all using (exists (
    select 1 from public.forms f
    where f.id = form_id and public.can_edit_workspace(f.workspace_id)
  )) with check (exists (
    select 1 from public.forms f
    where f.id = form_id and public.can_edit_workspace(f.workspace_id)
  ));

drop policy "webhook_endpoints: members manage via form" on public.webhook_endpoints;
create policy "webhook_endpoints: members read via form" on public.webhook_endpoints
  for select using (exists (
    select 1 from public.forms f
    where f.id = form_id and public.is_workspace_member(f.workspace_id)
  ));
create policy "webhook_endpoints: editors manage via form" on public.webhook_endpoints
  for all using (exists (
    select 1 from public.forms f
    where f.id = form_id and public.can_edit_workspace(f.workspace_id)
  )) with check (exists (
    select 1 from public.forms f
    where f.id = form_id and public.can_edit_workspace(f.workspace_id)
  ));

drop policy "sheets_connections: members manage" on public.sheets_connections;
create policy "sheets_connections: members read" on public.sheets_connections
  for select using (public.is_workspace_member(workspace_id));
create policy "sheets_connections: editors manage" on public.sheets_connections
  for all using (public.can_edit_workspace(workspace_id))
  with check (
    public.can_edit_workspace(workspace_id)
    and exists (
      select 1 from public.forms f
      where f.id = sheets_connections.form_id
        and f.workspace_id = sheets_connections.workspace_id
    )
  );

-- ---------------------------------------------------------------------
-- members: owner and admins manage; the owner's own row is protected
-- ---------------------------------------------------------------------
-- The owner keeps "owner can manage" (it's also what lets
-- create_workspace_with_owner insert the very first, owner, row); admins
-- get the same, with the owner's own row protected by the trigger below.
create policy "workspace_members: admins can manage" on public.workspace_members
  for all using (public.can_admin_workspace(workspace_id))
  with check (public.can_admin_workspace(workspace_id));

-- Nobody but the workspace's owner holds 'owner', and the owner's row
-- can't be changed or removed while the workspace exists (deleting the
-- workspace cascades past this). Ownership transfer isn't offered yet.
create function public.protect_workspace_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select owner_id into v_owner from public.workspaces where id = old.workspace_id;
    if v_owner is not null and old.user_id = v_owner then
      if tg_op = 'DELETE' then
        raise exception 'The workspace owner can''t be removed.' using errcode = 'P0001';
      end if;
      if new.role::text <> 'owner' or new.user_id <> old.user_id then
        raise exception 'The workspace owner''s role can''t be changed.' using errcode = 'P0001';
      end if;
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.role::text = 'owner' then
    select owner_id into v_owner from public.workspaces where id = new.workspace_id;
    if v_owner is distinct from new.user_id then
      raise exception 'Only the workspace owner can have the owner role.' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger workspace_members_protect_owner
  before insert or update or delete on public.workspace_members
  for each row execute function public.protect_workspace_owner();

-- ---------------------------------------------------------------------
-- invitations
-- ---------------------------------------------------------------------
create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (email = lower(email) and length(email) <= 320),
  role text not null check (role in ('admin', 'editor', 'viewer')),
  -- SHA-256 of the invite token; the token is only in the link.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  revoked_at timestamptz
);

create index workspace_invitations_workspace_id_idx
  on public.workspace_invitations (workspace_id);
-- One open invitation per address per workspace.
create unique index workspace_invitations_open_email_idx
  on public.workspace_invitations (workspace_id, email)
  where accepted_at is null and revoked_at is null;

alter table public.workspace_invitations enable row level security;
-- Admins see and revoke their workspace's invitations; creating and
-- accepting go through the server (token generation, seat checks).
create policy "workspace_invitations: admins can read" on public.workspace_invitations
  for select using (public.can_admin_workspace(workspace_id));
create policy "workspace_invitations: admins can revoke" on public.workspace_invitations
  for update using (public.can_admin_workspace(workspace_id))
  with check (public.can_admin_workspace(workspace_id));
grant select, update on public.workspace_invitations to authenticated;

-- ---------------------------------------------------------------------
-- folders (P2.20)
-- ---------------------------------------------------------------------
create table public.folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);

create index folders_workspace_id_idx on public.folders (workspace_id);

alter table public.folders enable row level security;
create policy "folders: members can read" on public.folders
  for select using (public.is_workspace_member(workspace_id));
create policy "folders: editors can manage" on public.folders
  for all using (public.can_edit_workspace(workspace_id))
  with check (public.can_edit_workspace(workspace_id));
grant select, insert, update, delete on public.folders to authenticated;

-- Deleting a folder never deletes its forms: they go back to "No folder".
alter table public.forms
  add column folder_id uuid references public.folders (id) on delete set null;
create index forms_folder_id_idx on public.forms (folder_id);

-- A form can only be filed in a folder of its own workspace.
create function public.check_form_folder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.folder_id is not null and not exists (
    select 1 from public.folders f
    where f.id = new.folder_id and f.workspace_id = new.workspace_id
  ) then
    raise exception 'That folder belongs to another workspace.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger forms_check_folder
  before insert or update of folder_id, workspace_id on public.forms
  for each row execute function public.check_form_folder();

-- ---------------------------------------------------------------------
-- storage: theme images are uploaded by editors (anyone can read them)
-- ---------------------------------------------------------------------
drop policy "theme-assets: members can manage own workspace assets" on storage.objects;
create policy "theme-assets: editors can manage own workspace assets" on storage.objects
  for all using (
    bucket_id = 'theme-assets'
    and public.can_edit_workspace(((storage.foldername(name))[1])::uuid)
  ) with check (
    bucket_id = 'theme-assets'
    and public.can_edit_workspace(((storage.foldername(name))[1])::uuid)
  );

-- ---------------------------------------------------------------------
-- profiles: people who share a workspace see each other's name and email
-- (the members list); still nobody else's.
-- ---------------------------------------------------------------------
create function public.shares_workspace_with(target_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members me
    join public.workspace_members them on them.workspace_id = me.workspace_id
    where me.user_id = auth.uid() and them.user_id = target_user_id
  );
$$;

create policy "profiles: teammates can read" on public.profiles
  for select using (public.shares_workspace_with(id));
