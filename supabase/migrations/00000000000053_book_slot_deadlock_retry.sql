-- Booking under load (master spec F-27, found 2026-11-03): two requests
-- inserting overlapping bookings at once can deadlock on the exclusion
-- constraint's check instead of one getting an exclusion violation.
-- book_slot caught only the violation, so a deadlocked request was
-- refused even when another host was free (never a double booking —
-- just a wrongly refused one). Now a deadlock retries the same host
-- (its half-done insert was rolled back, so the other request can
-- finish), a few times, before moving on.
create or replace function public.book_slot(
  p_booking_type_id uuid,
  p_host_ids uuid[],
  p_starts_at timestamptz,
  p_form_id uuid,
  p_response_id uuid,
  p_attendee_name text,
  p_attendee_email text,
  p_attendee_time_zone text,
  p_manage_token_hash text,
  p_rescheduled_from uuid default null
)
returns table (id uuid, host_id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.booking_types;
  v_end timestamptz;
  v_host uuid;
  v_try integer;
begin
  select * into t from public.booking_types bt where bt.id = p_booking_type_id and bt.archived_at is null;
  if not found then
    raise exception 'booking type not found';
  end if;
  v_end := p_starts_at + make_interval(mins => t.duration_minutes);

  begin
    update public.bookings b set status = 'cancelled', cancelled_at = now(), cancelled_by = 'system'
      where b.status = 'pending' and b.created_at < now() - interval '15 minutes'
        and b.host_id = any (p_host_ids);
  exception when deadlock_detected then
    -- Another request is lapsing the same holds; it will finish them.
    null;
  end;

  foreach v_host in array p_host_ids loop
    v_try := 0;
    loop
      v_try := v_try + 1;
      begin
        return query
          insert into public.bookings as b (
            booking_type_id, host_id, form_id, response_id, starts_at, ends_at, blocked,
            attendee_name, attendee_email, attendee_time_zone, manage_token_hash, rescheduled_from
          ) values (
            p_booking_type_id, v_host, p_form_id, p_response_id, p_starts_at, v_end,
            tstzrange(
              p_starts_at - make_interval(mins => t.buffer_before_minutes),
              v_end + make_interval(mins => t.buffer_after_minutes),
              '[)'
            ),
            p_attendee_name, p_attendee_email, p_attendee_time_zone, p_manage_token_hash, p_rescheduled_from
          )
          returning b.id, b.host_id, b.starts_at, b.ends_at;
        return;
      exception
        when exclusion_violation then
          -- That host is taken; try the next.
          exit;
        when deadlock_detected then
          -- Racing another request for this host: ours was undone, so
          -- theirs can finish. Try this host again, then move on.
          exit when v_try >= 3;
          perform pg_sleep(0.01 * v_try);
      end;
    end loop;
  end loop;
end;
$$;
revoke all on function public.book_slot(uuid, uuid[], timestamptz, uuid, uuid, text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.book_slot(uuid, uuid[], timestamptz, uuid, uuid, text, text, text, text, uuid)
  to service_role;
