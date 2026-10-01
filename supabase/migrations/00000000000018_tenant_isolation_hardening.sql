-- Tenant isolation hardening. Found by testing the Data API directly as
-- a second signed-in user and as an anonymous visitor (see
-- tests/integration/rls-isolation.test.ts).

-- ---------------------------------------------------------------------
-- 1. Anyone signed in could make themselves an OWNER of any workspace.
--    "user can insert own owner row" only checked user_id = auth.uid().
--    Workspace creation goes through create_workspace_with_owner, whose
--    insert is authorised by "owner can manage" (the caller owns the
--    workspace they just created), so the policy was never needed.
-- ---------------------------------------------------------------------
drop policy "workspace_members: user can insert own owner row" on public.workspace_members;

-- ---------------------------------------------------------------------
-- 2. Every form (drafts included, with workspace_id, title, slug) was
--    readable by anonymous visitors AND any signed-in user, which also
--    handed attackers the workspace ids needed for the takeover above.
--    The public page now reads forms and published versions through the
--    server (service role), so no public read policy is needed at all.
-- ---------------------------------------------------------------------
drop policy "forms: anon can read non-deleted for slug resolution" on public.forms;
drop policy "form_versions: anon can read published" on public.form_versions;
revoke select on public.forms from anon;
revoke select on public.form_versions from anon;

-- ---------------------------------------------------------------------
-- 3. A Sheets connection could name another workspace's form_id, so the
--    service-role sync would append that tenant's responses to the
--    attacker's spreadsheet. Enforce form ↔ workspace in the schema.
-- ---------------------------------------------------------------------
alter table public.forms add constraint forms_id_workspace_id_key unique (id, workspace_id);

alter table public.sheets_connections
  add constraint sheets_connections_form_workspace_fkey
  foreign key (form_id, workspace_id) references public.forms (id, workspace_id)
  on delete cascade;

drop policy "sheets_connections: members manage" on public.sheets_connections;
create policy "sheets_connections: members manage" on public.sheets_connections
  for all
  using (public.is_workspace_member(workspace_id))
  with check (
    public.is_workspace_member(workspace_id)
    and exists (
      select 1 from public.forms f
      where f.id = sheets_connections.form_id
        and f.workspace_id = sheets_connections.workspace_id
    )
  );

-- ---------------------------------------------------------------------
-- 4. Clients could publish arbitrary JSON (bypassing the application's
--    validation and compilation) by calling publish_form_version, or by
--    writing status = 'published' straight to form_versions. Publishing
--    is now server-only; clients keep editing drafts.
-- ---------------------------------------------------------------------
revoke execute on function public.publish_form_version(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.publish_form_version(uuid, jsonb) to service_role;

revoke insert, update on public.form_versions from authenticated;
-- New versions made by clients are always drafts (status defaults to
-- 'draft'); a draft's schema and revision are the only things they edit.
grant insert (form_id, version_number, schema) on public.form_versions to authenticated;
grant update (schema, revision) on public.form_versions to authenticated;

-- Unpublishing stays available to members, through a function that
-- checks membership itself.
create function public.unpublish_form(target_form_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.forms f
    where f.id = target_form_id and public.is_workspace_member(f.workspace_id)
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  update public.form_versions
  set status = 'archived'
  where form_id = target_form_id and status = 'published';
end;
$$;

revoke all on function public.unpublish_form(uuid) from public, anon;
grant execute on function public.unpublish_form(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. analytics_events rows without a form were readable by every
--    signed-in user.
-- ---------------------------------------------------------------------
drop policy "analytics_events: members read via form" on public.analytics_events;
create policy "analytics_events: members read via form" on public.analytics_events
  for select using (
    exists (
      select 1 from public.forms f
      where f.id = analytics_events.form_id and public.is_workspace_member(f.workspace_id)
    )
  );
