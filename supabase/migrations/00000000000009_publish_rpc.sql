-- Publishing: archives the currently published version (if any) and
-- inserts a new immutable published version, atomically. The draft row
-- is left untouched — publishing never mutates it, and editing the
-- draft afterward never touches what was just published (see
-- ARCHITECTURE.md "Versioning"). Republish is just calling this again;
-- unpublish is a plain archive with no new insert (see unpublish
-- below).
--
-- security invoker (the default): runs as the calling user, so the
-- existing form_versions RLS policies (insert/update scoped to
-- workspace members via forms) are the real authorization boundary —
-- this function exists for atomicity, not to bypass them.
create function public.publish_form_version(target_form_id uuid, compiled_schema jsonb)
returns public.form_versions
language plpgsql
as $$
declare
  next_version integer;
  new_version public.form_versions;
begin
  -- Serializes concurrent publish calls for the same form (e.g. two
  -- open builder tabs both hitting Publish) so the version_number
  -- computation below can't race.
  perform 1 from public.forms where id = target_form_id for update;

  update public.form_versions
  set status = 'archived'
  where form_id = target_form_id and status = 'published';

  select coalesce(max(version_number), 0) + 1 into next_version
  from public.form_versions
  where form_id = target_form_id;

  insert into public.form_versions (form_id, status, version_number, schema, published_at)
  values (target_form_id, 'published', next_version, compiled_schema, now())
  returning * into new_version;

  return new_version;
end;
$$;

grant execute on function public.publish_form_version(uuid, jsonb) to authenticated;
