-- Form archiving to the developer spec (26 Nov 2026, item 4).
--
-- Archiving takes a form out of use without deleting anything:
--   * it's unpublished (the published version is kept, so publishing again
--     rebuilds it), its link shows "no longer available" (HTTP 410);
--   * queued deliveries for its responses (webhooks, Slack, n8n, Sheets,
--     app connectors) are cancelled, each with a reason the response's
--     timeline shows;
--   * its A/B tests stop;
--   * it refuses while bookings are coming up, unless the user keeps them
--     (their reminders still go out).
-- Restoring brings it back unpublished, with the same slug, responses and
-- settings. Owners, admins and editors may do either; viewers can't.

alter table public.forms
  add column archived_by uuid references public.profiles (id) on delete set null;

-- Unpublishing needs the publish permission in the database too (it only
-- checked membership; the app checked the rest).
create or replace function public.unpublish_form(target_form_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.forms f
    where f.id = target_form_id
      and public.can_edit_workspace(f.workspace_id)
      and public.has_permission(f.workspace_id, 'publish')
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  update public.form_versions
  set status = 'archived'
  where form_id = target_form_id and status = 'published';
end;
$$;

/** Archives a form. Returns {ok: true, cancelled} or {ok: false, code}:
 * denied, not_found, or upcoming_bookings (with the bookings, until the
 * caller passes p_keep_bookings). The service role (the public API, after
 * checking the key's workspace) may call it too. */
create function public.archive_form(p_form_id uuid, p_keep_bookings boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '15s'
as $$
declare
  v_form record;
  v_service boolean := coalesce(auth.role(), '') = 'service_role';
  v_upcoming jsonb;
  v_count integer;
  v_cancelled integer := 0;
  v_n integer;
  v_reason constant text := 'Not sent: the form was archived.';
begin
  select f.id, f.workspace_id, f.archived_at into v_form
    from public.forms f
   where f.id = p_form_id and f.deleted_at is null
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not v_service and not public.can_edit_workspace(v_form.workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'denied');
  end if;
  if v_form.archived_at is not null then
    return jsonb_build_object('ok', true, 'cancelled', 0, 'already', true);
  end if;

  select count(*), coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'starts_at', b.starts_at, 'attendee_name', b.attendee_name)
           order by b.starts_at) filter (where b.rn <= 20), '[]'::jsonb)
    into v_count, v_upcoming
    from (select b.*, row_number() over (order by b.starts_at) rn
            from public.bookings b
           where b.form_id = p_form_id and b.status in ('pending', 'confirmed')
             and b.starts_at > now()) b;
  if v_count > 0 and not p_keep_bookings then
    return jsonb_build_object('ok', false, 'code', 'upcoming_bookings',
                              'count', v_count, 'bookings', v_upcoming);
  end if;

  update public.forms
     set archived_at = now(), archived_by = auth.uid()
   where id = p_form_id;
  update public.form_versions set status = 'archived'
   where form_id = p_form_id and status = 'published';

  update public.webhook_deliveries d
     set status = 'exhausted', last_error = v_reason, updated_at = now()
    from public.webhook_endpoints e
   where e.id = d.endpoint_id and e.form_id = p_form_id
     and d.status in ('pending', 'failed');
  get diagnostics v_n = row_count;
  v_cancelled := v_cancelled + v_n;

  update public.sheets_sync_log l
     set status = 'exhausted', last_error = v_reason, updated_at = now()
    from public.sheets_connections c
   where c.id = l.connection_id and c.form_id = p_form_id
     and l.status in ('pending', 'failed');
  get diagnostics v_n = row_count;
  v_cancelled := v_cancelled + v_n;

  -- Response jobs only: a kept booking's calendar jobs carry on.
  update public.connector_jobs j
     set status = 'skipped', last_error = v_reason, updated_at = now()
   where j.status in ('pending', 'failed') and j.booking_id is null
     and j.response_id in (select r.id from public.responses r where r.form_id = p_form_id);
  get diagnostics v_n = row_count;
  v_cancelled := v_cancelled + v_n;

  update public.experiments
     set status = 'stopped', ended_at = now()
   where status = 'running' and (form_id = p_form_id or variant_form_id = p_form_id);

  return jsonb_build_object('ok', true, 'cancelled', v_cancelled,
                            'kept_bookings', v_count);
end;
$$;

/** Restores an archived form, unpublished (publishing it again restarts
 * its integrations). */
create function public.restore_form(p_form_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form record;
begin
  select f.id, f.workspace_id, f.archived_at into v_form
    from public.forms f
   where f.id = p_form_id and f.deleted_at is null
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.can_edit_workspace(v_form.workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'denied');
  end if;
  update public.forms set archived_at = null, archived_by = null where id = p_form_id;
  return jsonb_build_object('ok', true, 'already', v_form.archived_at is null);
end;
$$;

revoke all on function public.archive_form(uuid, boolean) from public, anon;
grant execute on function public.archive_form(uuid, boolean) to authenticated, service_role;
revoke all on function public.restore_form(uuid) from public, anon;
grant execute on function public.restore_form(uuid) to authenticated, service_role;

-- Archived forms answer "no longer available" (HTTP 410) at the edge: the
-- proxy asks this, cached for a minute, with the anon key.
create function public.form_is_archived(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.forms f
                  where f.slug = p_slug and f.deleted_at is null and f.archived_at is not null);
$$;
revoke all on function public.form_is_archived(text) from public;
grant execute on function public.form_is_archived(text) to anon, authenticated, service_role;
