-- Bug fix: the dashboard's "Edited 5m ago" reads forms.updated_at, but
-- nearly all editing happens on the form's draft row in form_versions
-- (autosave), which never touched the parent form. A form edited a
-- minute ago kept showing its creation / last-rename time, and the
-- dashboard's "most recently edited first" ordering was wrong too.
--
-- Fix: any insert/update of a version (autosave, publish, unpublish)
-- bumps its form's updated_at. security definer so the touch doesn't
-- depend on the caller also holding UPDATE on forms (e.g. RPCs that run
-- with narrower grants); it writes nothing but the timestamp.
create function public.touch_form_on_version_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.forms set updated_at = now() where id = new.form_id;
  return null;
end;
$$;

create trigger form_versions_touch_form
  after insert or update on public.form_versions
  for each row execute function public.touch_form_on_version_write();
