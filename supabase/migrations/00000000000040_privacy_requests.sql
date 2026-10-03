-- Privacy requests (P3.17): find every response in a workspace that
-- carries a person's email address — an answer that is exactly that
-- address (an email question, or a text question used for one) or a
-- contact step's email — so it can be exported or erased on request. security invoker:
-- only responses the caller may read are found.
create function public.responses_by_email(p_workspace_id uuid, p_email text)
returns table (
  response_id uuid,
  form_id uuid,
  form_title text,
  status public.response_status,
  started_at timestamptz,
  completed_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct r.id, f.id, f.title, r.status, r.started_at, r.completed_at
  from public.responses r
  join public.forms f on f.id = r.form_id
  join public.answers a on a.response_id = r.id
  where f.workspace_id = p_workspace_id
    and length(btrim(p_email)) >= 3
    and (
      (jsonb_typeof(a.value) = 'string' and lower(a.value #>> '{}') = lower(btrim(p_email)))
      or (jsonb_typeof(a.value) = 'object' and lower(a.value ->> 'email') = lower(btrim(p_email)))
    )
  order by r.started_at desc
  limit 500
$$;
grant execute on function public.responses_by_email(uuid, text) to authenticated;
