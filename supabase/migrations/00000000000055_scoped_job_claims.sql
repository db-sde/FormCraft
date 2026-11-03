-- Hardening (2026-11-03): a request only runs its own jobs.
--
-- After a submit (and after a replay, a booking change), the request
-- used to run the whole due queue — up to 25 other workspaces' webhook
-- deliveries, Sheets rows and app syncs — inside one respondent's
-- request. These claim the due jobs of one response (or booking) only;
-- everything else is left to the scheduled workers (migration 54).
-- Same lease rules as the queue-wide claims, so the two never collide.

create function public.claim_response_webhook_deliveries(
  p_response_id uuid, p_limit integer, p_lease_seconds integer
)
returns setof public.webhook_deliveries
language sql
as $$
  with due as (
    select id from public.webhook_deliveries
    where response_id = p_response_id
      and status in ('pending', 'failed') and next_attempt_at <= now()
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

create function public.claim_response_sheets_syncs(
  p_response_id uuid, p_limit integer, p_lease_seconds integer
)
returns setof public.sheets_sync_log
language sql
as $$
  with due as (
    select id from public.sheets_sync_log
    where response_id = p_response_id
      and status in ('pending', 'failed') and next_attempt_at <= now()
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

create function public.claim_scoped_connector_jobs(
  p_response_id uuid, p_booking_id uuid, p_limit integer, p_lease_seconds integer
)
returns setof public.connector_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    update public.connector_jobs j
      set status = 'running',
          attempt_count = j.attempt_count + 1,
          next_attempt_at = now() + make_interval(secs => p_lease_seconds),
          updated_at = now()
      where j.id in (
        select c.id from public.connector_jobs c
        left join public.bookings b on b.id = c.booking_id
        where (
            (p_response_id is not null and (c.response_id = p_response_id or b.response_id = p_response_id))
            or (p_booking_id is not null and c.booking_id = p_booking_id)
          )
          and (
            (c.status in ('pending', 'failed') and c.next_attempt_at <= now())
            or (c.status = 'running' and c.next_attempt_at <= now())
          )
        order by c.next_attempt_at
        limit p_limit
        for update of c skip locked
      )
      returning j.*;
end;
$$;

revoke all on function public.claim_response_webhook_deliveries(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.claim_response_sheets_syncs(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.claim_scoped_connector_jobs(uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_response_webhook_deliveries(uuid, integer, integer) to service_role;
grant execute on function public.claim_response_sheets_syncs(uuid, integer, integer) to service_role;
grant execute on function public.claim_scoped_connector_jobs(uuid, uuid, integer, integer) to service_role;

-- The scoped claims (and each response's timeline) look jobs up by
-- response.
create index if not exists webhook_deliveries_response_idx on public.webhook_deliveries (response_id);
create index if not exists sheets_sync_log_response_idx on public.sheets_sync_log (response_id);
