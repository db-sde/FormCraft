-- Phase 0 guardrails (master spec F-26, F-46, F-47, F-48): when a form
-- stops taking responses, how many it takes, who may open it, and
-- whether a submission must pass a CAPTCHA.

-- 1. Availability and spam settings. Form-level, like the other
-- respondent settings: they take effect at once, without republishing.
alter table public.forms
  add column closes_at timestamptz,
  add column closed_message text
    check (closed_message is null or char_length(closed_message) <= 500),
  add column response_cap integer
    check (response_cap is null or response_cap between 1 and 1000000),
  add column full_message text
    check (full_message is null or char_length(full_message) <= 500),
  add column captcha_required boolean not null default false;

-- When this response passed the form's CAPTCHA. Checked once per
-- response: a resubmit after fixing an answer doesn't need a new token
-- (Cloudflare tokens are single-use).
alter table public.responses
  add column captcha_verified_at timestamptz;

-- 2. Form passwords: a salted scrypt hash, which only the server reads
-- or writes. Workspace members can read every column of `forms`, so the
-- hash lives in its own table with row-level security on and no
-- policies at all. A form is password-protected exactly when it has a
-- row here.
create table public.form_access_secrets (
  form_id uuid primary key references public.forms (id) on delete cascade,
  password_hash text not null check (char_length(password_hash) <= 300),
  updated_at timestamptz not null default now()
);

alter table public.form_access_secrets enable row level security;
-- Like every table since migration 37, even though members get no
-- access here at all.
create policy "mfa: second factor when enrolled" on public.form_access_secrets as restrictive
  for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
revoke all on public.form_access_secrets from anon, authenticated;
grant select, insert, update, delete on public.form_access_secrets to service_role;

-- 3. Completion refuses a closed or full form. This is the one place a
-- response becomes completed, and the decision is made in the same
-- transaction as the write: a page loaded before the deadline can't
-- submit after it, and two people racing for the last place can't both
-- get it. Unchanged otherwise (see migration 22).
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
  v_closes_at timestamptz;
  v_cap integer;
  v_taken bigint;
begin
  select * into r from public.responses where id = p_response_id for update;
  if not found then
    return query select 'not_found'::text, null::text, null::uuid;
    return;
  end if;

  -- A retried submit of a response that already went through still
  -- succeeds, whatever has happened to the form since.
  if r.status = 'completed' then
    return query select 'already'::text, r.ending_id, r.form_id;
    return;
  end if;

  select f.closes_at, f.response_cap into v_closes_at, v_cap
  from public.forms f where f.id = r.form_id;

  if v_closes_at is not null and now() >= v_closes_at then
    return query select 'closed'::text, null::text, r.form_id;
    return;
  end if;

  if v_cap is not null then
    -- Completions of a capped form take turns on the form's row, so the
    -- count below always includes the one that finished just before.
    -- (NO KEY UPDATE: new responses, which only reference the form, can
    -- still be started meanwhile.)
    perform 1 from public.forms f where f.id = r.form_id for no key update;
    -- Suspected spam never uses up a place.
    select count(*) into v_taken
    from public.responses x
    where x.form_id = r.form_id and x.status = 'completed' and not x.spam_suspected;
    if v_taken >= v_cap then
      return query select 'full'::text, null::text, r.form_id;
      return;
    end if;
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
