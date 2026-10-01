-- Creating a form inserted the form and then its first draft as two
-- requests; a failure in between left a form on the dashboard with no
-- editable draft. One function = one transaction.
--
-- security invoker (the default): row-level security applies exactly as
-- if the caller made both inserts, so this adds atomicity, not access.
create function public.create_form_with_draft(
  p_workspace_id uuid,
  p_title text,
  p_slug text,
  p_schema jsonb,
  -- Only used when there's no end-user session (the server's own admin
  -- client); a signed-in caller is always recorded as themselves.
  p_created_by uuid default null
)
returns uuid
language plpgsql
as $$
declare
  new_form_id uuid;
begin
  insert into public.forms (workspace_id, title, slug, created_by)
  values (p_workspace_id, p_title, p_slug, coalesce(auth.uid(), p_created_by))
  returning id into new_form_id;

  insert into public.form_versions (form_id, version_number, schema)
  values (new_form_id, 1, p_schema);

  return new_form_id;
end;
$$;

revoke all on function public.create_form_with_draft(uuid, text, text, jsonb, uuid) from public, anon;
grant execute on function public.create_form_with_draft(uuid, text, text, jsonb, uuid) to authenticated;
