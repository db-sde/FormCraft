-- QA retest enhancements (EN-01, EN-03).

-- EN-01: free-text search across a form's responses. Each answer keeps a
-- lower-cased text copy of its value (generated, so it can never drift),
-- with a trigram index so "contains" searches stay fast on big forms.
-- Row-level security on `answers` still decides who can search what.
create extension if not exists pg_trgm with schema extensions;

alter table public.answers
  add column search_text text generated always as (lower(value::text)) stored;

create index answers_search_text_trgm_idx
  on public.answers using gin (search_text extensions.gin_trgm_ops);

-- EN-03: how far respondents got, for the drop-off chart. One row per
-- (question they were last on, status) with a count — aggregated here
-- so a popular form is never fetched row by row. Preview traffic never
-- counts. Runs as the caller: RLS limits it to forms they can read.
create function public.response_reach(target_form_id uuid, since timestamptz default null)
returns table (last_question_id text, status text, responses integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.last_question_id, r.status::text, count(*)::integer
  from public.responses r
  where r.form_id = target_form_id
    and not r.is_preview
    and (since is null or r.started_at >= since)
  group by r.last_question_id, r.status
$$;

grant execute on function public.response_reach(uuid, timestamptz) to authenticated;
