-- Hardening (2026-11-03): the Integrations page lists a form's data
-- lookups with the editor's own access instead of the service role.
-- Editors may read every column except the encrypted header value,
-- which stays server-only (column-level grant).
grant select (id, form_id, name, trigger_question_id, url, header_name, outputs, enabled, created_at)
  on public.form_lookups to authenticated;
create policy "form_lookups: editors read" on public.form_lookups
  for select using (exists (
    select 1 from public.forms f where f.id = form_id and public.can_edit_workspace(f.workspace_id)
  ));
