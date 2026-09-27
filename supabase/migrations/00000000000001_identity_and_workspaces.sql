-- Identity & workspace domain: profiles, workspaces, workspace_members.
-- Every protected query in the app joins through workspace_members.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- profiles: 1:1 with auth.users
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Extra profile fields for auth.users, 1:1.';

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- workspaces
-- ---------------------------------------------------------------------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  owner_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workspaces_owner_id_idx on public.workspaces (owner_id);

-- ---------------------------------------------------------------------
-- workspace_members
-- ---------------------------------------------------------------------
create type public.workspace_role as enum ('owner', 'editor');

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.workspace_role not null default 'editor',
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index workspace_members_user_id_idx on public.workspace_members (user_id);
create index workspace_members_workspace_id_idx on public.workspace_members (workspace_id);

-- A workspace always needs its owner as a member row too. Enforced in the
-- application layer at creation time (single transaction: insert workspace,
-- insert owner membership) rather than via trigger, to keep creation logic
-- in one place (src/domains/workspaces).

-- ---------------------------------------------------------------------
-- helper: is the current auth user a member of a given workspace?
-- security definer + explicit search_path so RLS policies can call this
-- without recursive-policy evaluation issues.
-- ---------------------------------------------------------------------
create function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
  );
$$;

create function public.workspace_role_for(target_workspace_id uuid)
returns public.workspace_role
language sql
security definer
stable
set search_path = public
as $$
  select wm.role
  from public.workspace_members wm
  where wm.workspace_id = target_workspace_id
    and wm.user_id = auth.uid()
  limit 1;
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

create policy "profiles: self read" on public.profiles
  for select using (id = auth.uid());

create policy "profiles: self update" on public.profiles
  for update using (id = auth.uid());

-- Includes owner_id = auth.uid() (not just is_workspace_member) so that
-- `insert ... returning *` in create_workspace_with_owner() can see its
-- own newly-created row: RLS requires RETURNING output to also satisfy
-- SELECT policies, and the owner's workspace_members row doesn't exist
-- yet at that point in the same transaction.
create policy "workspaces: members can read" on public.workspaces
  for select using (owner_id = auth.uid() or public.is_workspace_member(id));

create policy "workspaces: owner can update" on public.workspaces
  for update using (owner_id = auth.uid());

create policy "workspaces: authenticated users can create" on public.workspaces
  for insert with check (owner_id = auth.uid());

create policy "workspaces: owner can delete" on public.workspaces
  for delete using (owner_id = auth.uid());

create policy "workspace_members: members can read roster" on public.workspace_members
  for select using (public.is_workspace_member(workspace_id));

create policy "workspace_members: owner can manage" on public.workspace_members
  for all using (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.owner_id = auth.uid()
    )
  );

create policy "workspace_members: user can insert own owner row" on public.workspace_members
  for insert with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();
