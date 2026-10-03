-- Progressive profiling (logic spec phase 23): a question marked "ask
-- once" isn't asked again of a visitor who already answered it on any
-- form in the same workspace. The visitor is the random first-party id
-- the proxy sets on public form pages (fc_vid) — not an account, and
-- never shared between workspaces.

create table public.visitor_profiles (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  visitor_id text not null check (visitor_id ~ '^[A-Za-z0-9-]{16,64}$'),
  -- The creator's name for the detail, shared by questions across forms.
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  value jsonb not null,
  -- Reused only by a question of the same type.
  question_type text not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, visitor_id, key)
);
create index visitor_profiles_updated_idx on public.visitor_profiles (updated_at);
-- No policies: only the server (public form page, submission) touches it.
alter table public.visitor_profiles enable row level security;
create policy "mfa: second factor when enrolled" on public.visitor_profiles as restrictive
  for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

-- Which visitor a response came from — recorded only for forms that use
-- "ask once", so their remembered answers can be updated and erased.
alter table public.responses
  add column visitor_id text check (visitor_id ~ '^[A-Za-z0-9-]{16,64}$');
create index responses_visitor_idx on public.responses (visitor_id)
  where visitor_id is not null;
