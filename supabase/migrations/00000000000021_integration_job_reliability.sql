-- Reliable background jobs for webhooks and Google Sheets.
--
-- Problems fixed:
--  * Two overlapping sweeps selected the same due rows and sent
--    duplicates (nothing claimed a row).
--  * Jobs were created after the response was sent, so a failure there
--    left a completed response with no job and nothing to retry.
--  * Enqueueing twice created two deliveries.

-- ---- Idempotent enqueue ------------------------------------------------

-- Clear any accidental duplicates before adding the constraints.
delete from public.webhook_deliveries d
using public.webhook_deliveries keep
where d.endpoint_id = keep.endpoint_id
  and d.response_id = keep.response_id
  and d.event_type = keep.event_type
  and d.response_id is not null
  and (d.created_at, d.id) > (keep.created_at, keep.id);

alter table public.webhook_deliveries
  add constraint webhook_deliveries_one_per_event unique (endpoint_id, response_id, event_type);

delete from public.sheets_sync_log d
using public.sheets_sync_log keep
where d.connection_id = keep.connection_id
  and d.response_id = keep.response_id
  and d.response_id is not null
  and (d.created_at, d.id) > (keep.created_at, keep.id);

alter table public.sheets_sync_log
  add constraint sheets_sync_log_one_per_response unique (connection_id, response_id);

-- ---- Claiming ----------------------------------------------------------
-- FOR UPDATE SKIP LOCKED lets any number of workers run at once without
-- picking the same row. Claiming pushes next_attempt_at out by a lease,
-- so a worker that dies mid-job releases the row automatically when the
-- lease runs out; a finished job then sets its own next_attempt_at.

create function public.claim_due_webhook_deliveries(p_limit integer, p_lease_seconds integer)
returns setof public.webhook_deliveries
language sql
as $$
  with due as (
    select id from public.webhook_deliveries
    where status in ('pending', 'failed') and next_attempt_at <= now()
    order by next_attempt_at
    limit p_limit
    for update skip locked
  )
  update public.webhook_deliveries d
  set next_attempt_at = now() + make_interval(secs => p_lease_seconds)
  from due
  where d.id = due.id
  returning d.*;
$$;

create function public.claim_due_sheets_syncs(p_limit integer, p_lease_seconds integer)
returns setof public.sheets_sync_log
language sql
as $$
  with due as (
    select id from public.sheets_sync_log
    where status in ('pending', 'failed') and next_attempt_at <= now()
    order by next_attempt_at
    limit p_limit
    for update skip locked
  )
  update public.sheets_sync_log l
  set next_attempt_at = now() + make_interval(secs => p_lease_seconds)
  from due
  where l.id = due.id
  returning l.*;
$$;

-- ---- Finding what was missed -------------------------------------------
-- Completed (and not spam-flagged) responses from the last day that an
-- enabled endpoint/connection has no job for — because the post-response
-- callback failed or the process was killed. Bounded to a day so that
-- enabling an integration doesn't backfill a form's whole history.

create function public.responses_missing_webhook_delivery(p_limit integer)
returns table (endpoint_id uuid, response_id uuid)
language sql
stable
as $$
  select we.id, r.id
  from public.webhook_endpoints we
  join public.responses r on r.form_id = we.form_id
  where we.enabled
    and r.status = 'completed'
    and not r.spam_suspected
    and r.completed_at > now() - interval '24 hours'
    and r.completed_at >= we.created_at
    and not exists (
      select 1 from public.webhook_deliveries d
      where d.endpoint_id = we.id and d.response_id = r.id
    )
  order by r.completed_at
  limit p_limit;
$$;

create function public.responses_missing_sheets_sync(p_limit integer)
returns table (connection_id uuid, response_id uuid)
language sql
stable
as $$
  select sc.id, r.id
  from public.sheets_connections sc
  join public.responses r on r.form_id = sc.form_id
  where sc.enabled
    and sc.spreadsheet_id is not null
    and r.status = 'completed'
    and not r.spam_suspected
    and r.completed_at > now() - interval '24 hours'
    and r.completed_at >= sc.created_at
    and not exists (
      select 1 from public.sheets_sync_log l
      where l.connection_id = sc.id and l.response_id = r.id
    )
  order by r.completed_at
  limit p_limit;
$$;

revoke all on function public.claim_due_webhook_deliveries(integer, integer) from public, anon, authenticated;
revoke all on function public.claim_due_sheets_syncs(integer, integer) from public, anon, authenticated;
revoke all on function public.responses_missing_webhook_delivery(integer) from public, anon, authenticated;
revoke all on function public.responses_missing_sheets_sync(integer) from public, anon, authenticated;
grant execute on function public.claim_due_webhook_deliveries(integer, integer) to service_role;
grant execute on function public.claim_due_sheets_syncs(integer, integer) to service_role;
grant execute on function public.responses_missing_webhook_delivery(integer) to service_role;
grant execute on function public.responses_missing_sheets_sync(integer) to service_role;
