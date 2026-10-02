-- Phase 3: audit logs (P3.14), version history (P3.10), retention (P3.16).

-- ---------------------------------------------------------------------
-- audit logs: who did what to what, when — no sensitive values
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- Null for the system (scheduled jobs) or an API key (see metadata).
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  target_type text check (target_type ~ '^[a-z_]{1,40}$'),
  target_id text check (length(target_id) <= 200),
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);
create index audit_logs_workspace_created_idx on public.audit_logs (workspace_id, created_at desc);

alter table public.audit_logs enable row level security;
-- Owners and admins read their workspace's log; nobody edits it (the
-- server writes with the service role; there are no write policies).
create policy "audit_logs: admins can read" on public.audit_logs
  for select using (public.can_admin_workspace(workspace_id));
grant select on public.audit_logs to authenticated;

-- ---------------------------------------------------------------------
-- version history: who published each version
-- ---------------------------------------------------------------------
alter table public.form_versions
  add column published_by uuid references public.profiles (id) on delete set null;

-- ---------------------------------------------------------------------
-- retention of completed responses (workspace policy)
-- ---------------------------------------------------------------------
alter table public.workspaces
  -- Delete completed responses this many days after submission; null
  -- keeps them. (Unfinished responses have their own per-form setting.)
  add column response_retention_days integer
    check (response_retention_days between 7 and 3650);
