-- Newer Supabase projects (this one included — see the auto_expose_new_tables
-- note in supabase/config.toml) do NOT auto-grant table privileges to the
-- Data API roles anymore. RLS policies only take effect once the role
-- already has the underlying SQL privilege, so both are required. Grants
-- here are deliberately scoped to match exactly what the RLS policies in
-- the preceding migrations already allow — this is not a widening of
-- access, just making the schema reachable at all.

grant usage on schema public to anon, authenticated;

grant select, update on public.profiles to authenticated;

grant select, insert, update, delete on public.workspaces to authenticated;
grant select, insert, update, delete on public.workspace_members to authenticated;

grant select, insert, update, delete on public.forms to authenticated;
grant select on public.forms to anon;

grant select, insert, update on public.form_versions to authenticated;
grant select on public.form_versions to anon;

grant select, delete on public.responses to authenticated;
grant select on public.answers to authenticated;
grant select on public.uploads to authenticated;

grant select, insert, update, delete on public.webhook_endpoints to authenticated;
grant select on public.webhook_deliveries to authenticated;
grant select, insert, update, delete on public.sheets_connections to authenticated;
grant select on public.sheets_sync_log to authenticated;
grant select on public.analytics_events to authenticated;
grant select on public.templates to authenticated;
grant select, insert, update, delete on public.notification_settings to authenticated;

-- Sequences/functions used by RLS helper functions and the workspace
-- creation RPC need EXECUTE, not table-level grants.
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.workspace_role_for(uuid) to authenticated;
grant execute on function public.create_workspace_with_owner(text, text) to authenticated;
