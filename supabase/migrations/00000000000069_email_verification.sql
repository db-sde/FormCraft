-- Email verification codes (roadmap #8, email only; 2026-11-20).
--
-- An email question can ask the respondent to prove the address is
-- theirs: a six-digit code is emailed, expires after ten minutes and
-- allows five tries; resending is spaced out and capped. The response
-- can't be submitted until the address it gives was verified. One row
-- per response and question, holding only a keyed hash of the code.
-- SMS codes are not part of this (they wait for an SMS provider, #41).

create table public.email_verifications (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.responses (id) on delete cascade,
  question_id text not null,
  email text not null check (char_length(email) <= 254),
  -- HMAC-SHA256 of the code with a server key: useless without it.
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  sends integer not null default 1 check (sends >= 1),
  last_sent_at timestamptz not null default now(),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (response_id, question_id)
);

alter table public.email_verifications enable row level security;
create policy "mfa: second factor when enrolled" on public.email_verifications as restrictive
  for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
-- Teammates who can see responses see whether an address was verified.
create policy "email_verifications: permitted members read via response"
  on public.email_verifications for select to authenticated
  using (exists (
    select 1 from public.responses r join public.forms f on f.id = r.form_id
    where r.id = response_id
      and public.has_permission(f.workspace_id, 'view_responses')
      and not (select public.response_is_confidential(r.form_id))
  ));
revoke all on public.email_verifications from anon, authenticated;
grant select (response_id, question_id, email, verified_at) on public.email_verifications
  to authenticated;

-- One try at a code, counted before it's checked so tries at the same
-- moment can't get past the limit. Returns the row as it now stands.
create or replace function public.email_verification_attempt(
  p_response_id uuid,
  p_question_id text
)
returns table (email text, code_hash text, expires_at timestamptz, attempts integer,
               verified_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  update public.email_verifications v
     set attempts = v.attempts + 1
   where v.response_id = p_response_id and v.question_id = p_question_id
     and v.verified_at is null
  returning v.email, v.code_hash, v.expires_at, v.attempts, v.verified_at;
$$;
revoke execute on function public.email_verification_attempt(uuid, text)
  from public, anon, authenticated;
grant execute on function public.email_verification_attempt(uuid, text) to service_role;
