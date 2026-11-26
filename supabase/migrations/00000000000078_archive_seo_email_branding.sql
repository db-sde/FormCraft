-- Three features from the pricing doc's Fomr.io review (26 Nov 2026):
--
-- * Form archiving (every plan): an archived form leaves the dashboard
--   list and stops taking responses; restoring brings it back. Nothing is
--   deleted.
-- * Link preview and SEO (custom from Starter): the title, description,
--   image and favicon a shared link shows, and whether search engines may
--   index the form. Free forms get the automatic preview.
-- * Email branding (Starter and up): the workspace's accent colour, logo,
--   footer and sender name on the emails respondents and the team get.
--
-- Plan checks are in the app (who may set them) and at render time (a
-- downgraded workspace falls back to the defaults); the columns only hold
-- what was set.

alter table public.forms
  add column archived_at timestamptz,
  add column seo jsonb not null default '{}'::jsonb
    check (jsonb_typeof(seo) = 'object' and pg_column_size(seo) <= 4096);

create index if not exists forms_workspace_active_idx
  on public.forms (workspace_id, updated_at desc)
  where deleted_at is null and archived_at is null;

alter table public.workspaces
  add column email_branding jsonb not null default '{}'::jsonb
    check (jsonb_typeof(email_branding) = 'object' and pg_column_size(email_branding) <= 4096);

-- Members already write forms and workspaces through their own policies;
-- the new columns follow them. Archived forms refuse new responses in the
-- database too, like a suspended workspace (migration 71).
create or replace function private.refuse_archived_form_responses()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.forms f
              where f.id = new.form_id and f.archived_at is not null) then
    raise exception 'this form is archived' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger responses_refuse_archived_form
  before insert on public.responses
  for each row execute function private.refuse_archived_form_responses();
