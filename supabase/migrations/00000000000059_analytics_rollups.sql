-- Hardening (2026-11-03): analytics events don't grow forever.
--
-- Raw events are kept 90 days (recent periods, embed stats and their
-- per-page-load dedupe read them). Older ones are folded into daily
-- counts per form, event type and preview flag, and deleted — in the
-- same statement, so an event is counted exactly once whichever table
-- it's in. Readers that go further back (the funnel's "all time" views)
-- add the daily counts (analytics_rolled_count).

create table public.analytics_daily (
  form_id uuid not null references public.forms (id) on delete cascade,
  day date not null,
  event_type text not null,
  is_preview boolean not null,
  count bigint not null check (count >= 0),
  primary key (form_id, day, event_type, is_preview)
);

alter table public.analytics_daily enable row level security;
create policy "mfa: second factor when enrolled" on public.analytics_daily as restrictive
  for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
create policy "analytics_daily: members read via form" on public.analytics_daily
  for select using (exists (
    select 1 from public.forms f
    where f.id = analytics_daily.form_id and public.is_workspace_member(f.workspace_id)
  ));
revoke all on public.analytics_daily from anon;
grant select on public.analytics_daily to authenticated;
grant select, insert, update, delete on public.analytics_daily to service_role;

-- Folds one batch of events older than p_keep_days into daily counts.
-- Returns how many raw events were folded (0: nothing left to do).
create function public.rollup_analytics_events(p_keep_days integer default 90, p_batch integer default 20000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_moved integer;
begin
  with moved as (
    delete from public.analytics_events e
    where e.id in (
      select id from public.analytics_events
      where created_at < (now() at time zone 'utc')::date - p_keep_days
        and form_id is not null
      limit p_batch
    )
    returning e.form_id, (e.created_at at time zone 'utc')::date as day, e.event_type, e.is_preview
  ), counted as (
    select form_id, day, event_type, is_preview, count(*) as n
    from moved group by 1, 2, 3, 4
  ), merged as (
    insert into public.analytics_daily as d (form_id, day, event_type, is_preview, count)
    select form_id, day, event_type, is_preview, n from counted
    on conflict (form_id, day, event_type, is_preview)
      do update set count = d.count + excluded.count
    returning 1
  )
  select coalesce(sum(n), 0)::integer into v_moved from counted;
  -- Events without a form (a deleted form's) can't be shown anywhere.
  delete from public.analytics_events
  where form_id is null and created_at < now() - make_interval(days => p_keep_days);
  return v_moved;
end;
$$;
revoke all on function public.rollup_analytics_events(integer, integer) from public, anon, authenticated;
grant execute on function public.rollup_analytics_events(integer, integer) to service_role;

-- Folded events of one type for a form since a day (null: all), as the
-- caller sees them (security invoker: RLS applies).
create function public.analytics_rolled_count(p_form_id uuid, p_event_type text, p_since date)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(count), 0)::bigint
  from public.analytics_daily
  where form_id = p_form_id and event_type = p_event_type and not is_preview
    and (p_since is null or day >= p_since);
$$;
revoke all on function public.analytics_rolled_count(uuid, text, date) from public, anon;
grant execute on function public.analytics_rolled_count(uuid, text, date) to authenticated, service_role;
