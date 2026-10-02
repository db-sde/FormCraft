-- Phase 3: scoped API keys (P3.11) and granular permissions (P3.15).

-- What a key may do. Existing keys keep everything they could do.
alter table public.api_keys
  add column scopes text[] not null default array['forms:read', 'responses:read', 'hooks:write']
    check (scopes <@ array['forms:read', 'responses:read', 'hooks:write']::text[]);

-- ---------------------------------------------------------------------
-- granular permissions: role defaults, per-member overrides
-- ---------------------------------------------------------------------
alter table public.workspace_members
  -- e.g. {"export_responses": false}; only these keys, booleans only.
  add column permissions jsonb not null default '{}'
    check (jsonb_typeof(permissions) = 'object');

-- Permissions:
--   view_responses       read responses, answers, files
--   export_responses     download CSVs
--   publish              publish / unpublish forms
--   manage_integrations  webhooks, Slack, Sheets, HubSpot, emails, payments
-- Owners and admins always have all of them. Editors have all by
-- default; viewers have view_responses only. Overrides can narrow (or,
-- for editors and viewers, widen) a member's defaults.
create function public.has_permission(target_workspace_id uuid, permission text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((
    select case
      when wm.role::text in ('owner', 'admin') then true
      when wm.permissions ? permission then (wm.permissions ->> permission)::boolean
      when wm.role::text = 'editor' then true
      when wm.role::text = 'viewer' then permission = 'view_responses'
      else false
    end
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id and wm.user_id = auth.uid()
  ), false);
$$;
grant execute on function public.has_permission(uuid, text) to authenticated;

-- Responses, answers and files: "view responses", not just membership.
drop policy "responses: members can read via form" on public.responses;
create policy "responses: permitted members can read via form" on public.responses
  for select using (exists (
    select 1 from public.forms f
    where f.id = form_id and public.has_permission(f.workspace_id, 'view_responses')
  ));

drop policy "answers: members can read via response" on public.answers;
create policy "answers: permitted members can read via response" on public.answers
  for select using (exists (
    select 1 from public.responses r join public.forms f on f.id = r.form_id
    where r.id = response_id and public.has_permission(f.workspace_id, 'view_responses')
  ));

drop policy "uploads: members can read via response" on public.uploads;
create policy "uploads: permitted members can read via response" on public.uploads
  for select using (exists (
    select 1 from public.responses r join public.forms f on f.id = r.form_id
    where r.id = response_id and public.has_permission(f.workspace_id, 'view_responses')
  ));

-- Integrations: editing them needs "manage integrations" as well.
drop policy "webhook_endpoints: editors manage via form" on public.webhook_endpoints;
create policy "webhook_endpoints: integration managers via form" on public.webhook_endpoints
  for all using (exists (
    select 1 from public.forms f
    where f.id = form_id and public.can_edit_workspace(f.workspace_id)
      and public.has_permission(f.workspace_id, 'manage_integrations')
  )) with check (exists (
    select 1 from public.forms f
    where f.id = form_id and public.can_edit_workspace(f.workspace_id)
      and public.has_permission(f.workspace_id, 'manage_integrations')
  ));

drop policy "sheets_connections: editors manage" on public.sheets_connections;
create policy "sheets_connections: integration managers" on public.sheets_connections
  for all using (
    public.can_edit_workspace(workspace_id)
    and public.has_permission(workspace_id, 'manage_integrations')
  ) with check (
    public.can_edit_workspace(workspace_id)
    and public.has_permission(workspace_id, 'manage_integrations')
    and exists (
      select 1 from public.forms f
      where f.id = sheets_connections.form_id
        and f.workspace_id = sheets_connections.workspace_id
    )
  );

drop policy "notification_settings: editors manage via form" on public.notification_settings;
create policy "notification_settings: integration managers via form" on public.notification_settings
  for all using (exists (
    select 1 from public.forms f
    where f.id = form_id and public.can_edit_workspace(f.workspace_id)
      and public.has_permission(f.workspace_id, 'manage_integrations')
  )) with check (exists (
    select 1 from public.forms f
    where f.id = form_id and public.can_edit_workspace(f.workspace_id)
      and public.has_permission(f.workspace_id, 'manage_integrations')
  ));

drop policy "confirmation_emails: editors manage via form" on public.confirmation_emails;
create policy "confirmation_emails: integration managers via form" on public.confirmation_emails
  for all using (exists (
    select 1 from public.forms f
    where f.id = form_id and public.can_edit_workspace(f.workspace_id)
      and public.has_permission(f.workspace_id, 'manage_integrations')
  )) with check (exists (
    select 1 from public.forms f
    where f.id = form_id and public.can_edit_workspace(f.workspace_id)
      and public.has_permission(f.workspace_id, 'manage_integrations')
  ));

-- Files in the private bucket follow the same "view responses" rule.
drop policy "response-uploads: members can read via response ownership" on storage.objects;
create policy "response-uploads: permitted members can read" on storage.objects
  for select using (
    bucket_id = 'response-uploads'
    and exists (
      select 1
      from public.uploads u
      join public.responses r on r.id = u.response_id
      join public.forms f on f.id = r.form_id
      where u.storage_path = objects.name
        and public.has_permission(f.workspace_id, 'view_responses')
    )
  );
