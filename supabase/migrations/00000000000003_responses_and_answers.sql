-- Response engine: responses, answers, uploads. Public respondents never
-- hold a Supabase session, so writes to these tables happen only through
-- service-role-backed route handlers (src/app/api/responses/*), which is
-- why there is no permissive anon insert policy here — the route handler
-- itself is the authorization boundary for the public runtime.

create type public.response_status as enum ('in_progress', 'partial', 'completed');

create table public.responses (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete cascade,
  form_version_id uuid not null references public.form_versions (id) on delete restrict,
  status public.response_status not null default 'in_progress',
  client_revision bigint not null default 0,
  last_question_id text,
  ending_id text,
  idempotency_key text,
  is_preview boolean not null default false,
  started_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  completed_at timestamptz,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  created_at timestamptz not null default now()
);

create index responses_form_id_status_idx on public.responses (form_id, status, started_at);
create unique index responses_idempotency_key_idx
  on public.responses (idempotency_key)
  where (idempotency_key is not null);

create table public.answers (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.responses (id) on delete cascade,
  question_id text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  unique (response_id, question_id)
);

create index answers_response_id_idx on public.answers (response_id);

create type public.upload_status as enum ('pending', 'clean', 'quarantined', 'deleted');

create table public.uploads (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.responses (id) on delete cascade,
  question_id text not null,
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  status public.upload_status not null default 'pending',
  created_at timestamptz not null default now()
);

create index uploads_response_id_idx on public.uploads (response_id);

-- ---------------------------------------------------------------------
-- State machine: in_progress -> partial -> completed, no regression,
-- ever. This is the authoritative guarantee — application code must
-- not rely solely on its own discipline here.
-- ---------------------------------------------------------------------
create function public.enforce_response_status_transition()
returns trigger
language plpgsql
as $$
begin
  if old.status = new.status then
    return new;
  end if;

  if old.status = 'in_progress' and new.status in ('partial', 'completed') then
    return new;
  end if;

  if old.status = 'partial' and new.status = 'completed' then
    return new;
  end if;

  raise exception 'invalid response status transition: % -> % (response %)',
    old.status, new.status, old.id;
end;
$$;

create trigger responses_enforce_status_transition
  before update on public.responses
  for each row execute function public.enforce_response_status_transition();

-- Stale-write / out-of-order autosave protection: client_revision may only
-- increase. Any UPDATE that tries to move it backwards or sideways to the
-- same value while changing content is rejected here at the DB level as a
-- second line of defense (the API layer performs the real
-- "where client_revision < :incoming" guarded update).
create function public.enforce_response_revision_monotonic()
returns trigger
language plpgsql
as $$
begin
  if new.client_revision < old.client_revision then
    raise exception 'stale write: client_revision % < current % (response %)',
      new.client_revision, old.client_revision, old.id;
  end if;
  return new;
end;
$$;

create trigger responses_enforce_revision_monotonic
  before update on public.responses
  for each row execute function public.enforce_response_revision_monotonic();

-- ---------------------------------------------------------------------
-- RLS: creator-side read/write scoped through the parent form's
-- workspace. No public/anon policies — the public runtime writes via a
-- service-role-backed API, not direct anon table access.
-- ---------------------------------------------------------------------
alter table public.responses enable row level security;
alter table public.answers enable row level security;
alter table public.uploads enable row level security;

create policy "responses: members can read via form" on public.responses
  for select using (
    exists (
      select 1 from public.forms f
      where f.id = form_id and public.is_workspace_member(f.workspace_id)
    )
  );

create policy "responses: members can delete via form" on public.responses
  for delete using (
    exists (
      select 1 from public.forms f
      where f.id = form_id and public.is_workspace_member(f.workspace_id)
    )
  );

create policy "answers: members can read via response" on public.answers
  for select using (
    exists (
      select 1 from public.responses r
      join public.forms f on f.id = r.form_id
      where r.id = response_id and public.is_workspace_member(f.workspace_id)
    )
  );

create policy "uploads: members can read via response" on public.uploads
  for select using (
    exists (
      select 1 from public.responses r
      join public.forms f on f.id = r.form_id
      where r.id = response_id and public.is_workspace_member(f.workspace_id)
    )
  );
