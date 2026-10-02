-- Resume links (PRD P2.8): a respondent can come back to an unfinished
-- response from another device or later, through an unguessable link.

alter table public.forms
  -- Creator's switch; off by default so nothing changes for existing forms.
  add column resume_links_enabled boolean not null default false;

create table public.resume_tokens (
  -- SHA-256 of the token; the token itself is only ever in the link.
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  response_id uuid not null references public.responses (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  revoked_at timestamptz
);

create index resume_tokens_response_id_idx on public.resume_tokens (response_id);

-- No policies: only the server (service role) reads or writes tokens.
alter table public.resume_tokens enable row level security;

-- A finished response can't be resumed: revoke its links when it
-- completes (the runtime also refuses completed responses).
create function public.revoke_resume_tokens_on_complete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    update public.resume_tokens
      set revoked_at = now()
      where response_id = new.id and revoked_at is null;
  end if;
  return new;
end;
$$;

create trigger responses_revoke_resume_tokens
  after update of status on public.responses
  for each row execute function public.revoke_resume_tokens_on_complete();
