-- Leads: everyone who left details in a Contact info block, across a
-- workspace (or one form). Done in the database so that it scales with
-- the data rather than with URL length or a 1000-row response cap, and
-- so the total is exact for paging.
--
-- A lead is a non-empty answer to the *first* contact block of the
-- response's form version (a response with two blocks is one lead).
-- Contact blocks are found in any version of the form: a lead captured
-- on an older published version is still a lead.
--
-- security invoker: row-level security applies, so a caller only ever
-- sees their own workspaces' data.
create function public.list_leads(
  p_workspace_id uuid,
  p_form_id uuid default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  response_id uuid,
  form_id uuid,
  form_title text,
  value jsonb,
  captured_at timestamptz,
  status public.response_status,
  last_active_at timestamptz,
  referrer text,
  utm_source text,
  total_count bigint
)
language sql
stable
as $$
  with first_blocks as (
    select distinct on (v.id) f.id as form_id, f.title as form_title, q ->> 'id' as question_id
    from public.forms f
    join public.form_versions v on v.form_id = f.id
    cross join lateral jsonb_array_elements(v.schema -> 'questions') as q
    where f.workspace_id = p_workspace_id
      and f.deleted_at is null
      and (p_form_id is null or f.id = p_form_id)
      and q ->> 'type' = 'contact_info'
    order by v.id, (q ->> 'order')::integer
  ),
  -- The same block appears in every version of a form (draft, published,
  -- archived): collapse to one row per form + question so a response
  -- isn't joined once per version.
  contact as (
    select distinct form_id, form_title, question_id from first_blocks
  ),
  hits as (
    select r.id as response_id, c.form_id, c.form_title, a.value,
           a.updated_at as captured_at, r.status, r.last_active_at,
           r.referrer, r.utm_source
    from contact c
    join public.responses r on r.form_id = c.form_id
    join public.answers a on a.response_id = r.id and a.question_id = c.question_id
    where a.value <> '{}'::jsonb
      and (
        nullif(trim(p_search), '') is null
        or (a.value ->> 'name') ilike '%' || replace(replace(trim(p_search), '%', '\%'), '_', '\_') || '%'
        or (a.value ->> 'email') ilike '%' || replace(replace(trim(p_search), '%', '\%'), '_', '\_') || '%'
        or (a.value ->> 'phone') ilike '%' || replace(replace(trim(p_search), '%', '\%'), '_', '\_') || '%'
        or (a.value ->> 'company') ilike '%' || replace(replace(trim(p_search), '%', '\%'), '_', '\_') || '%'
      )
  )
  select h.*, count(*) over () as total_count
  from hits h
  order by h.captured_at desc, h.response_id
  limit p_limit offset p_offset;
$$;

revoke all on function public.list_leads(uuid, uuid, text, integer, integer) from public, anon;
grant execute on function public.list_leads(uuid, uuid, text, integer, integer) to authenticated;
