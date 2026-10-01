-- A cleared answer used to leave its old value in the database (the
-- upsert only touched keys present with a value), and a contact block
-- with every field cleared stayed as an empty-object answer that still
-- counted as a lead. Empty answers are now removed.

create or replace function public.save_response_progress(
  p_response_id uuid,
  p_revision bigint,
  p_last_question_id text,
  p_answers jsonb,
  p_has_answer boolean
)
returns table (outcome text, status public.response_status, client_revision bigint)
language plpgsql
as $$
declare
  r public.responses;
  keeps_partials boolean;
begin
  -- Serialises concurrent saves/submits for this response.
  select * into r from public.responses where id = p_response_id for update;
  if not found then
    return query select 'not_found'::text, null::public.response_status, null::bigint;
    return;
  end if;

  if r.status = 'completed' then
    -- A late autosave after submit: a harmless no-op.
    return query select 'completed'::text, r.status, r.client_revision;
    return;
  end if;

  if r.client_revision >= p_revision then
    return query select 'stale'::text, r.status, r.client_revision;
    return;
  end if;

  select f.save_partial_responses into keeps_partials
  from public.forms f where f.id = r.form_id;
  if keeps_partials is false then
    -- The creator opted out of keeping unfinished answers: store nothing.
    return query select 'ok'::text, r.status, r.client_revision;
    return;
  end if;

  update public.responses as t
  set status = case when p_has_answer then 'partial'::public.response_status else t.status end,
      client_revision = p_revision,
      last_question_id = p_last_question_id,
      last_active_at = now()
  where t.id = p_response_id
  returning t.status, t.client_revision into status, client_revision;

  -- An answer the respondent cleared is removed, not left behind as the
  -- old text (and a contact block with every field cleared is no lead).
  delete from public.answers a
  where a.response_id = p_response_id
    and a.question_id in (select e.key from jsonb_each(p_answers) as e where e.value in ('""'::jsonb, '{}'::jsonb, '[]'::jsonb, 'null'::jsonb));

  insert into public.answers (response_id, question_id, value, updated_at)
  select p_response_id, e.key, e.value, now()
  from jsonb_each(p_answers) as e
  where e.value not in ('""'::jsonb, '{}'::jsonb, '[]'::jsonb, 'null'::jsonb)
  on conflict (response_id, question_id)
  do update set value = excluded.value, updated_at = excluded.updated_at;

  outcome := 'ok';
  return next;
end;
$$;

create or replace function public.complete_response_atomic(
  p_response_id uuid,
  p_revision bigint,
  p_last_question_id text,
  -- Only answers on the path the respondent actually took.
  p_answers jsonb,
  p_ending_id text,
  p_idempotency_key text,
  p_spam boolean default false
)
returns table (outcome text, ending_id text, form_id uuid)
language plpgsql
as $$
declare
  r public.responses;
begin
  select * into r from public.responses where id = p_response_id for update;
  if not found then
    return query select 'not_found'::text, null::text, null::uuid;
    return;
  end if;

  if r.status = 'completed' then
    return query select 'already'::text, r.ending_id, r.form_id;
    return;
  end if;

  insert into public.answers (response_id, question_id, value, updated_at)
  select p_response_id, e.key, e.value, now()
  from jsonb_each(p_answers) as e
  where e.value not in ('""'::jsonb, '{}'::jsonb, '[]'::jsonb, 'null'::jsonb)
  on conflict (response_id, question_id)
  do update set value = excluded.value, updated_at = excluded.updated_at;

  -- Answers left behind on a branch the respondent later logic-jumped
  -- away from, and ones the respondent cleared, aren't part of this
  -- submission.
  delete from public.answers a
  where a.response_id = p_response_id
    and not (
      a.question_id = any (
        select e.key from jsonb_each(p_answers) as e where e.value not in ('""'::jsonb, '{}'::jsonb, '[]'::jsonb, 'null'::jsonb)
      )
    );

  update public.responses as t
  set status = 'completed',
      -- Never move the revision backwards (a trigger rejects that).
      client_revision = greatest(p_revision, t.client_revision + 1),
      last_question_id = p_last_question_id,
      last_active_at = now(),
      completed_at = now(),
      ending_id = p_ending_id,
      idempotency_key = p_idempotency_key,
      spam_suspected = p_spam
  where t.id = p_response_id;

  return query select 'completed'::text, p_ending_id, r.form_id;
end;
$$;

