-- Two-factor authentication (P3.13). Supabase Auth does TOTP; this makes
-- the database insist on it. Someone with only a password gets an aal1
-- session — enough to finish signing in, never to read or change
-- workspace data, even straight through the API with that token.

create function public.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    or not exists (
      select 1 from auth.mfa_factors f
      where f.user_id = auth.uid() and f.status = 'verified'
    );
$$;
grant execute on function public.mfa_satisfied() to authenticated;

-- Every tenant table: an extra, restrictive condition for signed-in users
-- (respondents and the server's service role are unaffected).
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and rowsecurity loop
    execute format(
      'create policy "mfa: second factor when enrolled" on public.%I as restrictive
         for all to authenticated
         using ((select public.mfa_satisfied()))
         with check ((select public.mfa_satisfied()))',
      t.tablename);
  end loop;
end;
$$;

-- The membership helpers behind policies and security-definer functions
-- answer "no" until the second factor is in.
create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.mfa_satisfied() and exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace_id and wm.user_id = auth.uid()
  );
$$;

create or replace function public.can_edit_workspace(target_workspace_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.mfa_satisfied() and exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.role::text in ('owner', 'admin', 'editor')
  );
$$;

create or replace function public.can_admin_workspace(target_workspace_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.mfa_satisfied() and exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.role::text in ('owner', 'admin')
  );
$$;

create or replace function public.has_permission(target_workspace_id uuid, permission text)
returns boolean language sql security definer stable set search_path = public as $$
  select public.mfa_satisfied() and coalesce((
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
  limit 1;
$$;

create or replace function public.shares_workspace_with(target_user_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.mfa_satisfied() and exists (
    select 1 from public.workspace_members me
    join public.workspace_members them on them.workspace_id = me.workspace_id
    where me.user_id = auth.uid() and them.user_id = target_user_id
  );
$$;

-- One-time recovery codes, hashed (SHA-256). Only the server reads them:
-- using one removes the authenticator so the person can set it up again.
create table public.mfa_recovery_codes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, code_hash)
);
alter table public.mfa_recovery_codes enable row level security;
-- No policies: server only.
