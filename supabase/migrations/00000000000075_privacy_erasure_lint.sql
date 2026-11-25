-- Super Admin, Phase 4 follow-up: the erasure function without a
-- temporary table. The database linter in CI can't see a table created
-- while a function runs, so it flagged the function; the same work is now
-- done from the list of response ids. Behaviour is unchanged.

create or replace function public.admin_apply_privacy_erasure(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '120s'
as $$
declare
  v_staff uuid;
  v_change private.change_requests;
  v_req private.privacy_requests;
  v_ids uuid[];
  v_files integer;
  v_hooks integer;
  v_profiles integer;
  v_bookings integer;
  v_per_ws jsonb;
  v_evidence jsonb;
  v_ws record;
begin
  v_staff := private.check_staff('privacy.manage', true);
  if v_staff is null then return private.denial(); end if;
  select * into v_change from private.change_requests where id = p_request_id;
  if not found or v_change.action <> 'privacy.erase' then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into v_req from private.privacy_requests where id = v_change.target_id::uuid for update;
  if not found or v_req.status <> 'open' or v_req.type <> 'erasure'
     or v_change.payload ->> 'email' is distinct from v_req.requester_email then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'why', 'request does not match');
  end if;
  if v_req.identity_verified_at is null then
    return jsonb_build_object('ok', false, 'code', 'not_verified');
  end if;
  if private.consume_approval(p_request_id, v_change.action, v_change.target_id, v_change.payload)
     is null then
    perform private.log_admin_action(
      v_staff, 'privacy.erase', 'denied', 'no approved request', 'privacy_request',
      v_req.id::text, null, p_request_id, '{}'::jsonb);
    return jsonb_build_object('ok', false, 'code', 'approval_required');
  end if;

  select coalesce(array_agg(distinct p.response_id), '{}') into v_ids
    from private.person_responses(v_req.requester_email) p;
  select coalesce(jsonb_object_agg(s.workspace_id, s.n), '{}'::jsonb) into v_per_ws
    from (select f.workspace_id, count(*) as n
            from public.responses r join public.forms f on f.id = r.form_id
           where r.id = any (v_ids)
           group by f.workspace_id) s;

  insert into private.storage_deletions (bucket, path, reason)
  select 'response-uploads', u.storage_path, 'privacy:' || v_req.id
    from public.uploads u where u.response_id = any (v_ids);
  get diagnostics v_files = row_count;

  -- Webhook payloads carry the answers and outlive the response.
  delete from public.webhook_deliveries where response_id = any (v_ids);
  get diagnostics v_hooks = row_count;

  -- Answers remembered for the person's browser ("ask once").
  delete from public.visitor_profiles v
   using (select distinct f.workspace_id, r.visitor_id
            from public.responses r join public.forms f on f.id = r.form_id
           where r.id = any (v_ids) and r.visitor_id is not null) e
   where v.workspace_id = e.workspace_id and v.visitor_id = e.visitor_id;
  get diagnostics v_profiles = row_count;

  -- Bookings keep the slot (calendars depend on it), not the person.
  update public.bookings
     set attendee_name = null, attendee_email = null, attendee_time_zone = null
   where lower(attendee_email) = v_req.requester_email or response_id = any (v_ids);
  get diagnostics v_bookings = row_count;

  -- Answers, follow-ups, uploads' rows, payments and the rest go with
  -- the response (foreign keys cascade).
  delete from public.responses where id = any (v_ids);

  -- Each workspace sees it in its own audit log.
  for v_ws in select key::uuid as id, value::int as n from jsonb_each_text(v_per_ws) loop
    insert into public.audit_logs (workspace_id, actor_id, action, target_type, target_id,
                                   metadata, reason, outcome)
    values (v_ws.id, null, 'support.privacy_erased', 'privacy_request', v_req.id::text,
            jsonb_build_object('by', 'FormCraft support', 'responses', v_ws.n),
            'A person asked FormCraft to erase their data', 'succeeded');
  end loop;

  v_evidence := jsonb_build_object(
    'erased_at', now(),
    'responses', cardinality(v_ids),
    'workspaces', v_per_ws,
    'files_queued', v_files,
    'webhook_payloads', v_hooks,
    'remembered_answers', v_profiles,
    'bookings_anonymised', v_bookings,
    'approval_id', p_request_id,
    'backups', 'Copies in database backups remain until the backups expire.');
  update private.privacy_requests
     set status = 'completed', completed_at = now(), handled_by = v_staff, evidence = v_evidence
   where id = v_req.id;
  perform private.log_admin_action(
    v_staff, 'privacy.erase', 'succeeded', v_change.reason, 'privacy_request', v_req.id::text,
    null, p_request_id, v_evidence - 'backups');
  return jsonb_build_object('ok', true, 'evidence', v_evidence);
end;
$$;
