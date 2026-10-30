-- Master spec Phase 1 (2026-10-29): kiosk mode (F-15) and reusable,
-- governed question blocks (F-09).

-- 1. Kiosk mode. Form-level like the other respondent settings: on when
-- kiosk_config is set ({ resetSeconds, idleSeconds }). The exit PIN is a
-- salted hash in its own server-only table, as form passwords are.
alter table public.forms
  add column kiosk_config jsonb
    check (kiosk_config is null or jsonb_typeof(kiosk_config) = 'object');

create table public.form_kiosk_secrets (
  form_id uuid primary key references public.forms (id) on delete cascade,
  pin_hash text not null check (char_length(pin_hash) <= 300),
  updated_at timestamptz not null default now()
);
alter table public.form_kiosk_secrets enable row level security;
create policy "mfa: second factor when enrolled" on public.form_kiosk_secrets as restrictive
  for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
revoke all on public.form_kiosk_secrets from anon, authenticated;
grant select, insert, update, delete on public.form_kiosk_secrets to service_role;

-- 2. Question blocks: a workspace's library of shared questions. A block
-- is a series of immutable versions; forms hold copies of one version's
-- questions (each tagged with the block, version, insertion and source
-- question), locked in the form and updated only when an editor of that
-- form reviews and applies a newer version (the product owner's call,
-- 2026-10-29). Editing a block publishes a new version; restoring an old
-- one publishes a copy of it.
create table public.question_blocks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  description text check (description is null or char_length(description) <= 500),
  current_version integer not null default 1 check (current_version >= 1),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Archived blocks keep their versions: forms that hold a copy still
  -- check against them, and can detach.
  archived_at timestamptz
);
create index question_blocks_workspace_idx on public.question_blocks (workspace_id);
create trigger question_blocks_set_updated_at
  before update on public.question_blocks
  for each row execute function public.set_updated_at();

create table public.question_block_versions (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.question_blocks (id) on delete cascade,
  version integer not null check (version >= 1),
  -- The block's questions (QuestionV1 content without form-only parts),
  -- validated by the server before it writes them.
  questions jsonb not null
    check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) between 1 and 50),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (block_id, version)
);

alter table public.question_blocks enable row level security;
alter table public.question_block_versions enable row level security;
create policy "mfa: second factor when enrolled" on public.question_blocks as restrictive
  for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
create policy "mfa: second factor when enrolled" on public.question_block_versions as restrictive
  for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

-- Everyone in the workspace may read and use blocks; editors and up
-- create and change them (the product owner's call). Versions are never
-- updated or deleted.
create policy "question_blocks: members read" on public.question_blocks
  for select using (public.is_workspace_member(workspace_id));
create policy "question_blocks: editors insert" on public.question_blocks
  for insert with check (public.can_edit_workspace(workspace_id));
create policy "question_blocks: editors update" on public.question_blocks
  for update using (public.can_edit_workspace(workspace_id))
  with check (public.can_edit_workspace(workspace_id));
create policy "question_block_versions: members read" on public.question_block_versions
  for select using (exists (
    select 1 from public.question_blocks b
    where b.id = block_id and public.is_workspace_member(b.workspace_id)
  ));
create policy "question_block_versions: editors insert" on public.question_block_versions
  for insert with check (exists (
    select 1 from public.question_blocks b
    where b.id = block_id and public.can_edit_workspace(b.workspace_id)
  ));
revoke all on public.question_blocks, public.question_block_versions from anon;
-- Table privileges are granted explicitly in this project (migration 7);
-- the policies above decide which rows.
grant select, insert, update on public.question_blocks to authenticated;
grant select, insert on public.question_block_versions to authenticated;
grant select, insert, update, delete on public.question_blocks, public.question_block_versions
  to service_role;

-- A new version, numbered in one transaction so two editors publishing at
-- once can't both take the same number. Runs as the caller: row-level
-- security decides whether they may.
create function public.publish_question_block_version(p_block_id uuid, p_questions jsonb)
returns integer
language plpgsql
as $$
declare
  v_next integer;
begin
  select b.current_version + 1 into v_next
  from public.question_blocks b
  where b.id = p_block_id and b.archived_at is null
  for update;
  if v_next is null then
    raise exception 'block not found' using errcode = 'P0002';
  end if;
  insert into public.question_block_versions (block_id, version, questions, created_by)
  values (p_block_id, v_next, p_questions, auth.uid());
  update public.question_blocks set current_version = v_next where id = p_block_id;
  return v_next;
end;
$$;
revoke all on function public.publish_question_block_version(uuid, jsonb) from public, anon;
grant execute on function public.publish_question_block_version(uuid, jsonb) to authenticated, service_role;
