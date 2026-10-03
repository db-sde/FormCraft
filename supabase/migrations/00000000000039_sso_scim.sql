-- Enterprise identity (Phase 3, Wave C): SAML single sign-on (P3.12) and
-- SCIM provisioning (P3.18).

update public.plans
  set entitlements = entitlements
    || jsonb_build_object('sso', id = 'enterprise', 'scim', id = 'enterprise');

-- ---------------------------------------------------------------------
-- SSO: which identity provider a workspace uses
-- ---------------------------------------------------------------------
-- Supabase Auth owns the SAML connection (`supabase sso add`); this maps
-- that provider to a workspace. `domain` and `provider_id` are set by an
-- operator with the service role (scripts/set-sso.ts) — never by a
-- workspace admin, who could otherwise point someone else's provider at
-- their own workspace. Admins choose the default role and whether SSO is
-- required.
create table public.workspace_sso (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  domain text not null unique check (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  provider_id uuid not null unique,
  -- Members must have signed in through the identity provider.
  enforced boolean not null default false,
  -- Role given to people who join by signing in with SSO, or via SCIM.
  default_role text not null default 'viewer' check (default_role in ('editor', 'viewer')),
  created_at timestamptz not null default now()
);
alter table public.workspace_sso enable row level security;
create policy "workspace_sso: members read" on public.workspace_sso
  for select using (public.is_workspace_member(workspace_id));
create policy "workspace_sso: admins update" on public.workspace_sso
  for update using (public.can_admin_workspace(workspace_id));
grant select on public.workspace_sso to authenticated;
-- Only the two settings an admin owns.
grant update (enforced, default_role) on public.workspace_sso to authenticated;

-- Whether a session's sign-in included SAML SSO (the `amr` claim).
create function public.jwt_has_sso(claims jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce((
    select bool_or(m ->> 'method' = 'sso/saml')
    from jsonb_array_elements(
      case when jsonb_typeof(claims -> 'amr') = 'array' then claims -> 'amr' else '[]'::jsonb end
    ) as m
  ), false);
$$;
grant execute on function public.jwt_has_sso(jsonb) to authenticated;

-- A workspace that requires SSO only opens to SSO sessions. The owner is
-- exempt, so a broken identity provider can't lock everyone out.
create function public.sso_satisfied(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
      select 1 from public.workspace_sso s
      where s.workspace_id = target_workspace_id and s.enforced
    )
    or public.jwt_has_sso(auth.jwt())
    or exists (
      select 1 from public.workspaces w
      where w.id = target_workspace_id and w.owner_id = auth.uid()
    );
$$;
grant execute on function public.sso_satisfied(uuid) to authenticated;

-- How many of the caller's workspaces this session can't open because
-- they require SSO (their membership rows are hidden too, so the app
-- can't count them itself). Lets it say "log in with SSO" instead of
-- treating them as someone with no workspace.
create function public.workspaces_requiring_sso()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.workspace_members wm
  where wm.user_id = auth.uid() and not public.sso_satisfied(wm.workspace_id);
$$;
grant execute on function public.workspaces_requiring_sso() to authenticated;

-- The membership helpers behind every policy now also require it.
create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.mfa_satisfied() and public.sso_satisfied(target_workspace_id) and exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace_id and wm.user_id = auth.uid()
  );
$$;

create or replace function public.can_edit_workspace(target_workspace_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.mfa_satisfied() and public.sso_satisfied(target_workspace_id) and exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.role::text in ('owner', 'admin', 'editor')
  );
$$;

create or replace function public.can_admin_workspace(target_workspace_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.mfa_satisfied() and public.sso_satisfied(target_workspace_id) and exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.role::text in ('owner', 'admin')
  );
$$;

create or replace function public.has_permission(target_workspace_id uuid, permission text)
returns boolean language sql security definer stable set search_path = public as $$
  select public.mfa_satisfied() and public.sso_satisfied(target_workspace_id) and coalesce((
    select case
      when wm.role::text in ('owner', 'admin') then true
      when wm.permissions ? permission then (wm.permissions ->> permission)::boolean
      when wm.role::text = 'editor' then true
      when wm.role::text = 'viewer' then permission = 'view_responses'
      else false
    end
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id and wm.user_id = auth.uid()
  ), false);
$$;

create or replace function public.workspace_role_for(target_workspace_id uuid)
returns public.workspace_role language sql security definer stable set search_path = public as $$
  select wm.role
  from public.workspace_members wm
  where wm.workspace_id = target_workspace_id
    and wm.user_id = auth.uid()
    and public.mfa_satisfied()
    and public.sso_satisfied(target_workspace_id)
  limit 1;
$$;

-- ---------------------------------------------------------------------
-- SCIM: the identity provider adds and removes members
-- ---------------------------------------------------------------------
-- One bearer token per workspace, stored as SHA-256 (shown once).
create table public.scim_tokens (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  prefix text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
-- No policies: the server reads and writes tokens; admins see a summary.
alter table public.scim_tokens enable row level security;

create function public.scim_status(p_workspace_id uuid)
returns table (prefix text, created_at timestamptz, last_used_at timestamptz)
language sql
security definer
stable
set search_path = public
as $$
  select t.prefix, t.created_at, t.last_used_at
  from public.scim_tokens t
  where t.workspace_id = p_workspace_id and public.can_admin_workspace(p_workspace_id);
$$;
grant execute on function public.scim_status(uuid) to authenticated;

-- The workspace's directory as the identity provider sent it. Supabase
-- never links an SSO sign-in to an existing account with the same email,
-- so SCIM can't create accounts ahead of time: it lists who may join,
-- and membership is granted when that person signs in with SSO
-- (`user_id` is filled in then). Deactivating or deleting a row removes
-- their membership.
create table public.scim_users (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (email = lower(email) and length(email) between 3 and 320),
  display_name text check (length(display_name) <= 200),
  external_id text check (length(external_id) <= 200),
  active boolean not null default true,
  user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, email)
);
-- No policies: only the SCIM endpoints (service role) touch it.
alter table public.scim_users enable row level security;

create policy "mfa: second factor when enrolled" on public.workspace_sso as restrictive
  for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
create policy "mfa: second factor when enrolled" on public.scim_tokens as restrictive
  for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
create policy "mfa: second factor when enrolled" on public.scim_users as restrictive
  for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
