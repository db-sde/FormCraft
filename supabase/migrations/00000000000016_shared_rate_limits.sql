-- Rate limiting that holds across server instances (PRD P1.22 / §3.5).
-- The in-memory limiter only protected a single Node process; on a
-- scaled deployment each instance had its own budget.

create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count integer not null
);

-- No policies: only the service role (which bypasses RLS) touches it.
alter table public.rate_limits enable row level security;

-- Counts one hit against `p_key` in a fixed window and reports whether
-- it's within `p_limit`. Atomic (single upsert), so concurrent requests
-- can't both slip under the limit.
create function public.hit_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.rate_limits as r (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update set
    window_start = case
      when r.window_start <= now() - make_interval(secs => p_window_seconds) then now()
      else r.window_start
    end,
    count = case
      when r.window_start <= now() - make_interval(secs => p_window_seconds) then 1
      else r.count + 1
    end
  returning count into v_count;
  return v_count <= p_limit;
end;
$$;

revoke all on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;
grant select, insert, update, delete on public.rate_limits to service_role;
