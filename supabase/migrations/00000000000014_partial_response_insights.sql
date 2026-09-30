-- Unfinished-response insights (PRD P2.7 / P2.10 / P2.11).

-- The two UTM parameters the start endpoint didn't store yet.
alter table public.responses
  add column utm_term text,
  add column utm_content text;

-- Where respondents stop: how many unfinished responses last touched
-- each question, counting only sessions idle for longer than the
-- abandonment threshold (someone still typing hasn't dropped off).
-- security invoker, so a creator only ever aggregates responses RLS
-- already lets them read.
create function public.response_dropoff(target_form_id uuid, idle_minutes integer)
returns table (question_id text, stopped integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.last_question_id, count(*)::integer
  from public.responses r
  where r.form_id = target_form_id
    and r.status in ('in_progress', 'partial')
    and r.last_question_id is not null
    and r.last_active_at < now() - make_interval(mins => idle_minutes)
  group by r.last_question_id
$$;

grant execute on function public.response_dropoff(uuid, integer) to authenticated;
