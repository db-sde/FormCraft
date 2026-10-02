-- Conversion insights (P3.8): starts and completions per traffic source.
-- The source is worked out like the dashboard does: the UTM source, else
-- the referring host (without www.), else "Direct". Preview and
-- suspected-spam sessions don't count. security invoker, so a member
-- only aggregates responses RLS already lets them read.
create function public.response_source_conversion(target_form_id uuid, since timestamptz default null)
returns table (source text, started integer, completed integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce(
      nullif(btrim(r.utm_source), ''),
      nullif(regexp_replace(substring(r.referrer from '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/:?#]+)'), '^www\.', ''), ''),
      'Direct'
    ) as source,
    count(*)::integer,
    (count(*) filter (where r.status = 'completed'))::integer
  from public.responses r
  where r.form_id = target_form_id
    and not r.is_preview
    and not r.spam_suspected
    and (since is null or r.started_at >= since)
  group by 1
$$;

grant execute on function public.response_source_conversion(uuid, timestamptz) to authenticated;
