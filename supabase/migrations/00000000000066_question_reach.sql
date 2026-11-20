-- How many responses actually reached each question (QA FC10-15 /
-- FC11-08), for Summary's drop-off chart. Before this, every response
-- was counted as having passed every question before the one it stopped
-- on, so a question that logic skipped still showed 100% reached.
--
-- A response reached a question when it answered it, was shown it (a
-- question_viewed event carrying the response id) or stopped on it.
-- Preview traffic never counts. Runs as the caller, so row-level
-- security scopes it to forms they can see.

create or replace function public.response_question_reach(
  target_form_id uuid,
  since timestamptz default null
)
returns table (question_id text, reached integer)
language sql
stable
set search_path = ''
as $$
  with scoped as (
    select r.id, r.last_question_id
    from public.responses r
    where r.form_id = target_form_id
      and not r.is_preview
      and (since is null or r.started_at >= since)
  ),
  touched as (
    select a.response_id as response_id, a.question_id
    from public.answers a
    join scoped s on s.id = a.response_id
    union
    select s.id, s.last_question_id
    from scoped s
    where s.last_question_id is not null
    union
    select s.id, e.metadata ->> 'questionId'
    from public.analytics_events e
    join scoped s on e.session_id = s.id::text
    where e.form_id = target_form_id
      and e.event_type = 'question_viewed'
      and not e.is_preview
  )
  select t.question_id, count(distinct t.response_id)::integer
  from touched t
  where t.question_id is not null
  group by t.question_id;
$$;

revoke execute on function public.response_question_reach(uuid, timestamptz)
  from public, anon;
grant execute on function public.response_question_reach(uuid, timestamptz)
  to authenticated, service_role;

create index if not exists analytics_events_form_session_idx
  on public.analytics_events (form_id, session_id)
  where event_type = 'question_viewed';
