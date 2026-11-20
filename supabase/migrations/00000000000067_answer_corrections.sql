-- Admin editing of submitted answers (roadmap #55, 2026-11-20).
--
-- A permitted teammate can correct an answer on a submitted response.
-- Every correction keeps the value it replaced, the new value, who, when
-- and why, so the respondent's original and every revision stay
-- recoverable. Only ordinary answers can be corrected: signatures,
-- orders, consent, uploads, bookings and the like are evidence and are
-- refused here, whatever the caller. Nothing is sent to integrations
-- again by a correction; replaying is a separate, deliberate action.

-- 1. The history. Written only by correct_submitted_answer below.
create table public.answer_revisions (
  id bigint generated always as identity primary key,
  response_id uuid not null references public.responses (id) on delete cascade,
  question_id text not null,
  -- null: there was no answer before / the answer was cleared.
  previous_value jsonb,
  new_value jsonb,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  edited_by uuid references public.profiles (id) on delete set null,
  request_id text,
  created_at timestamptz not null default now()
);
create index answer_revisions_response_idx
  on public.answer_revisions (response_id, created_at);

alter table public.answer_revisions enable row level security;
create policy "mfa: second factor when enrolled" on public.answer_revisions as restrictive
  for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
-- Read by whoever may read the response's answers (confidential forms
-- hide individual responses, so their revisions too).
create policy "answer_revisions: permitted members read via response"
  on public.answer_revisions for select to authenticated
  using (exists (
    select 1 from public.responses r join public.forms f on f.id = r.form_id
    where r.id = response_id
      and public.has_permission(f.workspace_id, 'view_responses')
      and not (select public.response_is_confidential(r.form_id))
  ));
revoke all on public.answer_revisions from anon, authenticated;
grant select on public.answer_revisions to authenticated;

-- 2. The timeline shows corrections.
alter table public.response_events drop constraint response_events_kind_check;
alter table public.response_events add constraint response_events_kind_check check (kind in (
  'email_owner', 'email_respondent', 'replay', 'status_changed', 'assigned', 'commented',
  'document_emailed', 'email_rule', 'booking', 'payment', 'answer_edited'
));

-- 3. A permission of its own, off unless given: owners and admins have
-- it; editors and viewers only when an owner or admin grants it.
create or replace function public.has_permission(target_workspace_id uuid, permission text)
returns boolean language sql security definer stable set search_path = public as $$
  select public.mfa_satisfied() and public.sso_satisfied(target_workspace_id) and coalesce((
    select case
      when wm.role::text in ('owner', 'admin') then true
      when wm.permissions ? permission then (wm.permissions ->> permission)::boolean
      when permission = 'edit_responses' then false
      when wm.role::text = 'editor' then true
      when wm.role::text = 'viewer' then permission = 'view_responses'
      else false
    end
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id and wm.user_id = auth.uid()
  ), false);
$$;

-- 4. One correction, all or nothing. Called by the server (service role)
-- after it has checked the caller's permission and validated the new
-- value against the question; this re-checks everything it can see.
create or replace function public.correct_submitted_answer(
  p_response_id uuid,
  p_question_id text,
  p_value jsonb,
  p_reason text,
  p_actor uuid,
  p_request_id text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_response record;
  v_type text;
  v_previous jsonb;
  v_revision bigint;
begin
  select r.id, r.status, r.is_preview, r.form_version_id, r.form_id
    into v_response
    from public.responses r
    where r.id = p_response_id
    for update;
  if not found then
    raise exception 'response_not_found' using errcode = 'P0002';
  end if;
  if v_response.status <> 'completed' or v_response.is_preview then
    raise exception 'not_submitted' using errcode = 'P0001';
  end if;
  if (select public.response_is_confidential(v_response.form_id)) then
    raise exception 'confidential' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  select q ->> 'type' into v_type
    from public.form_versions v,
         jsonb_array_elements(v.schema -> 'questions') q
    where v.id = v_response.form_version_id and q ->> 'id' = p_question_id;
  if v_type is null then
    raise exception 'question_not_found' using errcode = 'P0001';
  end if;
  if v_type not in (
    'short_text', 'long_text', 'email', 'phone', 'url', 'number',
    'single_select', 'multi_select', 'dropdown', 'yes_no',
    'date', 'time', 'rating', 'opinion_scale'
  ) then
    raise exception 'not_editable' using errcode = 'P0001';
  end if;

  select a.value into v_previous
    from public.answers a
    where a.response_id = p_response_id and a.question_id = p_question_id
    for update;
  if v_previous is not distinct from p_value then
    raise exception 'unchanged' using errcode = 'P0001';
  end if;

  if p_value is null then
    delete from public.answers
      where response_id = p_response_id and question_id = p_question_id;
  else
    insert into public.answers (response_id, question_id, value)
      values (p_response_id, p_question_id, p_value)
      on conflict (response_id, question_id)
      do update set value = excluded.value, updated_at = now();
  end if;

  insert into public.answer_revisions
    (response_id, question_id, previous_value, new_value, reason, edited_by, request_id)
    values (p_response_id, p_question_id, v_previous, p_value, btrim(p_reason), p_actor,
            p_request_id)
    returning id into v_revision;

  insert into public.response_events (response_id, kind, detail, actor_id)
    values (p_response_id, 'answer_edited',
            jsonb_build_object('questionId', p_question_id, 'revision', v_revision),
            p_actor);

  return v_revision;
end;
$$;

revoke execute on function public.correct_submitted_answer(uuid, text, jsonb, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.correct_submitted_answer(uuid, text, jsonb, text, uuid, text)
  to service_role;
