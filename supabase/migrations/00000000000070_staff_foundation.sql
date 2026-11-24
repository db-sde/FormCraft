-- Super Admin, Phase 0 (docs/super-admin-design.md §3.2–3.6):
-- FormCraft staff, the permission gate every admin action passes
-- through, an insert-only hash-chained audit log, and two-person
-- approvals for high-risk actions.
--
-- Everything lives in the `private` schema, which the Data API doesn't
-- expose and no API role can use. The only way in is the `admin_*`
-- functions in `public`, each of which starts with private.check_staff().

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Staff
-- ---------------------------------------------------------------------------

create table private.staff_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null
    check (role in ('owner', 'admin', 'support', 'billing', 'privacy', 'read_only')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  created_at timestamptz not null default now(),
  created_by uuid references private.staff_members (user_id) on delete set null,
  disabled_at timestamptz
);

-- Overrides can only take a permission away from a role, never add one.
create table private.staff_permission_removals (
  user_id uuid not null references private.staff_members (user_id) on delete cascade,
  permission text not null,
  primary key (user_id, permission)
);

/** What each role may do (docs/super-admin-design.md §3.3). */
create function private.role_permissions(p_role text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'owner' then array[
      'portal.access', 'customers.read', 'customers.status', 'plans.read',
      'plans.change', 'ai.settings', 'privacy.manage', 'comms.send', 'ops.read',
      'staff.manage', 'approvals.decide', 'audit.read']
    when 'admin' then array[
      'portal.access', 'customers.read', 'customers.status', 'plans.read',
      'plans.change', 'ai.settings', 'privacy.manage', 'comms.send', 'ops.read',
      'approvals.decide', 'audit.read']
    when 'support' then array['portal.access', 'customers.read', 'plans.read', 'ops.read']
    when 'billing' then array[
      'portal.access', 'customers.read', 'plans.read', 'plans.change', 'approvals.decide']
    when 'privacy' then array[
      'portal.access', 'customers.read', 'privacy.manage', 'approvals.decide']
    when 'read_only' then array['portal.access', 'customers.read', 'plans.read', 'ops.read']
    else array[]::text[]
  end;
$$;

create function private.staff_has(p_user_id uuid, p_permission text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from private.staff_members s
    where s.user_id = p_user_id
      and s.status = 'active'
      and p_permission = any (private.role_permissions(s.role))
      and not exists (
        select 1 from private.staff_permission_removals r
        where r.user_id = s.user_id and r.permission = p_permission
      )
  );
$$;

-- Staff accounts are not customers: they belong to no workspace.
create function private.refuse_staff_membership()
returns trigger
language plpgsql
security definer  -- members can't read private.staff_members themselves
set search_path = ''
as $$
begin
  if exists (select 1 from private.staff_members where user_id = new.user_id) then
    raise exception 'staff accounts can''t join workspaces' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger workspace_members_no_staff
  before insert or update of user_id on public.workspace_members
  for each row execute function private.refuse_staff_membership();

-- ---------------------------------------------------------------------------
-- 2. The audit log: insert-only, hash-chained
-- ---------------------------------------------------------------------------

create table private.platform_audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  staff_id uuid,                 -- null when the caller isn't staff
  actor_user_id uuid,            -- auth.uid() of the caller, staff or not
  action text not null,
  outcome text not null check (outcome in ('succeeded', 'failed', 'denied')),
  reason text,
  target_type text,
  target_id text,
  workspace_id uuid,
  approval_id uuid,
  -- From the caller's Supabase session row, not from anything the caller sends.
  session_id uuid,
  ip inet,
  user_agent text,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  prev_hash bytea,
  row_hash bytea not null
);
create index platform_audit_log_at_idx on private.platform_audit_log (at desc);
create index platform_audit_log_target_idx on private.platform_audit_log (target_type, target_id);

create function private.audit_row_hash(
  p_prev bytea, p_at timestamptz, p_staff uuid, p_actor uuid, p_action text,
  p_outcome text, p_reason text, p_target_type text, p_target_id text,
  p_workspace uuid, p_approval uuid, p_session uuid, p_ip inet, p_ua text, p_details jsonb
)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.sha256(
    coalesce(p_prev, '\x'::bytea) || convert_to(concat_ws(
      '|',
      to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
      coalesce(p_staff::text, '-'), coalesce(p_actor::text, '-'), p_action, p_outcome,
      coalesce(p_reason, '-'), coalesce(p_target_type, '-'), coalesce(p_target_id, '-'),
      coalesce(p_workspace::text, '-'), coalesce(p_approval::text, '-'),
      coalesce(p_session::text, '-'), coalesce(host(p_ip), '-'), coalesce(p_ua, '-'),
      p_details::text
    ), 'UTF8')
  );
$$;

/** The one way to write the audit log. Chained under a lock so writers
 * at the same moment keep one chain. Called inside the action's own
 * transaction: the action and its entry commit or roll back together. */
create function private.log_admin_action(
  p_staff_id uuid,
  p_action text,
  p_outcome text,
  p_reason text default null,
  p_target_type text default null,
  p_target_id text default null,
  p_workspace_id uuid default null,
  p_approval_id uuid default null,
  p_details jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session record;
  v_prev bytea;
  v_at timestamptz := clock_timestamp();
  v_id bigint;
  v_actor uuid := auth.uid();
  v_session_id uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(hashtext('private.platform_audit_log'));
  select s.ip, s.user_agent into v_session from auth.sessions s where s.id = v_session_id;
  select l.row_hash into v_prev from private.platform_audit_log l order by l.id desc limit 1;
  insert into private.platform_audit_log (
    at, staff_id, actor_user_id, action, outcome, reason, target_type, target_id,
    workspace_id, approval_id, session_id, ip, user_agent, details, prev_hash, row_hash
  ) values (
    v_at, p_staff_id, v_actor, p_action, p_outcome, nullif(btrim(p_reason), ''),
    p_target_type, p_target_id, p_workspace_id, p_approval_id, v_session_id,
    v_session.ip, left(v_session.user_agent, 300), coalesce(p_details, '{}'::jsonb),
    v_prev,
    private.audit_row_hash(
      v_prev, v_at, p_staff_id, v_actor, p_action, p_outcome, nullif(btrim(p_reason), ''),
      p_target_type, p_target_id, p_workspace_id, p_approval_id, v_session_id,
      v_session.ip, left(v_session.user_agent, 300), coalesce(p_details, '{}'::jsonb)
    )
  ) returning id into v_id;
  return v_id;
end;
$$;

create function private.refuse_audit_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'the platform audit log can only be added to' using errcode = 'P0001';
end;
$$;
create trigger platform_audit_log_insert_only
  before update or delete on private.platform_audit_log
  for each row execute function private.refuse_audit_change();
create trigger platform_audit_log_no_truncate
  before truncate on private.platform_audit_log
  for each statement execute function private.refuse_audit_change();

/** The first entry whose hash doesn't match (or null when the chain is
 * whole), and the head hash to keep outside the database. */
create function public.admin_verify_audit_chain()
returns table (first_broken_id bigint, entries bigint, head_hash text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  v_prev bytea := null;
  v_broken bigint := null;
  v_count bigint := 0;
begin
  for r in select * from private.platform_audit_log order by id loop
    v_count := v_count + 1;
    if v_broken is null and (
      r.prev_hash is distinct from v_prev
      or r.row_hash <> private.audit_row_hash(
        r.prev_hash, r.at, r.staff_id, r.actor_user_id, r.action, r.outcome, r.reason,
        r.target_type, r.target_id, r.workspace_id, r.approval_id, r.session_id, r.ip,
        r.user_agent, r.details)
    ) then
      v_broken := r.id;
    end if;
    v_prev := r.row_hash;
  end loop;
  return query select v_broken, v_count, encode(v_prev, 'hex');
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The gate
-- ---------------------------------------------------------------------------

-- When each staff session last passed the gate: the idle timeout. (Supabase
-- only updates a session when its token refreshes, about hourly, so its
-- own timestamps can't measure 30 minutes of inactivity.)
create table private.staff_session_activity (
  session_id uuid primary key,
  user_id uuid not null,
  last_seen_at timestamptz not null default now()
);

/** A TOTP check within the last `p_within` (the JWT's `amr` lists each
 * method with its time). */
create function private.recent_totp(p_jwt jsonb, p_within interval)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from jsonb_array_elements(coalesce(p_jwt -> 'amr', '[]'::jsonb)) m
    where m ->> 'method' = 'totp'
      and to_timestamp((m ->> 'timestamp')::double precision) > now() - p_within
  );
$$;

/**
 * Called first by every admin_* function. Returns the staff id, or null
 * after recording the denial. It never raises: an exception would roll
 * back the "denied" entry together with everything else.
 *
 * Requires: a second factor in this session (always, not "if enrolled");
 * a session that still exists (signing out or disabling cuts access at
 * once), at most 12 hours old and used through the gate in the last 30
 * minutes;
 * active staff holding the permission; and, for high-risk calls, a TOTP
 * check in the last 10 minutes.
 */
create function private.check_staff(p_permission text, p_step_up boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_jwt jsonb := auth.jwt();
  v_why text;
  v_staff uuid;
begin
  if v_uid is null then
    v_why := 'not_signed_in';
  elsif coalesce(v_jwt ->> 'aal', 'aal1') <> 'aal2' then
    v_why := 'no_second_factor';
  elsif not exists (
    select 1 from auth.sessions s
    where s.id = nullif(v_jwt ->> 'session_id', '')::uuid
      and s.user_id = v_uid
      and s.created_at > now() - interval '12 hours'
  ) then
    v_why := 'session_expired';
  elsif exists (
    select 1 from private.staff_session_activity a
    where a.session_id = (v_jwt ->> 'session_id')::uuid
      and a.last_seen_at < now() - interval '30 minutes'
  ) then
    v_why := 'session_idle';
  elsif not private.staff_has(v_uid, p_permission) then
    v_why := 'not_permitted';
  elsif p_step_up and not private.recent_totp(v_jwt, interval '10 minutes') then
    v_why := 'step_up_required';
  end if;

  if v_why is not null then
    -- For the caller's own answer (private.denial()), this transaction only.
    perform pg_catalog.set_config('formcraft.deny_reason', v_why, true);
    select user_id into v_staff from private.staff_members where user_id = v_uid;
    perform private.log_admin_action(
      v_staff, p_permission, 'denied', null, null, null, null, null,
      jsonb_build_object('why', v_why));
    return null;
  end if;
  insert into private.staff_session_activity (session_id, user_id, last_seen_at)
  values ((v_jwt ->> 'session_id')::uuid, v_uid, now())
  on conflict (session_id) do update set last_seen_at = excluded.last_seen_at;
  return v_uid;
end;
$$;

/** What an admin_* function answers when check_staff said no: the reason
 * lets the portal ask for a fresh code instead of just refusing. */
create function private.denial()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'ok', false, 'code', 'denied',
    'why', coalesce(nullif(current_setting('formcraft.deny_reason', true), ''), 'not_permitted'));
$$;

-- ---------------------------------------------------------------------------
-- 4. Two-person approvals
-- ---------------------------------------------------------------------------

create table private.change_requests (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  target_type text not null,
  target_id text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  payload_hash bytea not null,
  reason text not null check (char_length(btrim(reason)) between 5 and 500),
  requested_by uuid not null references private.staff_members (user_id),
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'executed', 'expired')),
  decided_by uuid references private.staff_members (user_id),
  decided_at timestamptz,
  decision_note text,
  executed_at timestamptz,
  emergency boolean not null default false,
  -- Nobody approves their own request (break-glass requests are owner-run
  -- and reviewed afterwards, so they carry no approver).
  check (decided_by is distinct from requested_by),
  check (emergency or status not in ('approved', 'executed') or decided_by is not null)
);
create index change_requests_pending_idx on private.change_requests (status, requested_at);

/** High-risk actions: what it takes to ask for one and to approve it. */
create function private.change_rules(p_action text)
returns table (request_permission text, approve_permission text, approver_roles text[])
language sql
immutable
set search_path = ''
as $$
  select r.request_permission, r.approve_permission, r.approver_roles from (values
    ('staff.add', 'staff.manage', 'approvals.decide', array['owner', 'admin']),
    ('staff.set_role', 'staff.manage', 'approvals.decide', array['owner', 'admin']),
    ('staff.disable', 'staff.manage', 'approvals.decide', array['owner', 'admin'])
  ) r(action, request_permission, approve_permission, approver_roles)
  where r.action = p_action;
$$;

create function public.admin_request_change(
  p_action text,
  p_target_type text,
  p_target_id text,
  p_payload jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_rule record;
  v_staff uuid;
  v_id uuid;
begin
  select * into v_rule from private.change_rules(p_action);
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_action');
  end if;
  v_staff := private.check_staff(v_rule.request_permission);
  if v_staff is null then return private.denial(); end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  insert into private.change_requests (
    action, target_type, target_id, payload, payload_hash, reason, requested_by
  ) values (
    p_action, p_target_type, p_target_id, coalesce(p_payload, '{}'::jsonb),
    pg_catalog.sha256(convert_to(coalesce(p_payload, '{}'::jsonb)::text, 'UTF8')),
    btrim(p_reason), v_staff
  ) returning id into v_id;
  perform private.log_admin_action(
    v_staff, 'change.requested', 'succeeded', btrim(p_reason), p_target_type, p_target_id,
    null, v_id, jsonb_build_object('action', p_action));
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create function public.admin_decide_change(p_id uuid, p_approve boolean, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_req private.change_requests;
  v_rule record;
  v_staff uuid;
begin
  -- Approving is a high-risk act itself: a fresh second factor.
  v_staff := private.check_staff('approvals.decide', true);
  if v_staff is null then return private.denial(); end if;
  select * into v_req from private.change_requests where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if v_req.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'not_pending');
  end if;
  if v_req.expires_at <= now() then
    update private.change_requests set status = 'expired' where id = p_id;
    return jsonb_build_object('ok', false, 'code', 'expired');
  end if;
  if v_req.requested_by = v_staff then
    perform private.log_admin_action(
      v_staff, 'change.decided', 'denied', 'own request', 'change_request', p_id::text,
      null, p_id, '{}'::jsonb);
    return jsonb_build_object('ok', false, 'code', 'own_request');
  end if;
  select * into v_rule from private.change_rules(v_req.action);
  if not private.staff_has(v_staff, v_rule.approve_permission)
     or not exists (
       select 1 from private.staff_members
       where user_id = v_staff and role = any (v_rule.approver_roles)
     ) then
    perform private.log_admin_action(
      v_staff, 'change.decided', 'denied', 'not an approver for this action',
      'change_request', p_id::text, null, p_id, '{}'::jsonb);
    return jsonb_build_object('ok', false, 'code', 'denied');
  end if;
  update private.change_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = v_staff, decided_at = now(),
         decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;
  perform private.log_admin_action(
    v_staff, case when p_approve then 'change.approved' else 'change.rejected' end,
    'succeeded', p_note, v_req.target_type, v_req.target_id, null, p_id,
    jsonb_build_object('action', v_req.action));
  return jsonb_build_object('ok', true);
end;
$$;

/** Used by each high-risk action: the approved request for exactly this
 * change, marked executed so it can't run twice. Null when there isn't
 * one. */
create function private.consume_approval(
  p_id uuid,
  p_action text,
  p_target_id text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req private.change_requests;
begin
  select * into v_req from private.change_requests where id = p_id for update;
  if not found
     or v_req.status <> 'approved'
     or v_req.expires_at <= now()
     or v_req.action <> p_action
     or v_req.target_id <> p_target_id
     or v_req.payload_hash <> pg_catalog.sha256(
          convert_to(coalesce(p_payload, '{}'::jsonb)::text, 'UTF8'))
  then
    return null;
  end if;
  update private.change_requests set status = 'executed', executed_at = now() where id = p_id;
  return p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The first high-risk actions: managing staff
-- ---------------------------------------------------------------------------

/** Adds staff, changes a role or disables someone — only with an approved
 * request for exactly that change. */
create function public.admin_apply_staff_change(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_staff uuid;
  v_req private.change_requests;
  v_target uuid;
  v_ok uuid;
begin
  v_staff := private.check_staff('staff.manage', true);
  if v_staff is null then return private.denial(); end if;
  select * into v_req from private.change_requests where id = p_request_id;
  if not found or v_req.action not in ('staff.add', 'staff.set_role', 'staff.disable') then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  v_ok := private.consume_approval(p_request_id, v_req.action, v_req.target_id, v_req.payload);
  if v_ok is null then
    perform private.log_admin_action(
      v_staff, v_req.action, 'denied', 'no approved request', 'staff', v_req.target_id,
      null, p_request_id, '{}'::jsonb);
    return jsonb_build_object('ok', false, 'code', 'approval_required');
  end if;
  v_target := v_req.target_id::uuid;
  if v_req.action = 'staff.add' then
    if exists (select 1 from public.workspace_members where user_id = v_target) then
      raise exception 'this account belongs to a customer workspace; use a staff-only account'
        using errcode = 'P0001';
    end if;
    insert into private.staff_members (user_id, role, display_name, created_by)
    values (v_target, v_req.payload ->> 'role', v_req.payload ->> 'display_name', v_staff);
  elsif v_req.action = 'staff.set_role' then
    update private.staff_members set role = v_req.payload ->> 'role' where user_id = v_target;
  else
    update private.staff_members set status = 'disabled', disabled_at = now()
     where user_id = v_target;
    -- Signed out everywhere at once: check_staff needs a live session.
    delete from auth.sessions where user_id = v_target;
  end if;
  perform private.log_admin_action(
    v_staff, v_req.action, 'succeeded', v_req.reason, 'staff', v_req.target_id, null,
    p_request_id, v_req.payload);
  return jsonb_build_object('ok', true);
end;
$$;

/** Who the caller is in the portal (any staff role). */
create function public.admin_whoami()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_staff uuid := private.check_staff('portal.access');
  v_row private.staff_members;
begin
  if v_staff is null then return private.denial(); end if;
  select * into v_row from private.staff_members where user_id = v_staff;
  return jsonb_build_object(
    'ok', true,
    'role', v_row.role,
    'display_name', v_row.display_name,
    'permissions', to_jsonb(array(
      select u.p from unnest(private.role_permissions(v_row.role)) with ordinality u(p, n)
      where not exists (
        select 1 from private.staff_permission_removals r
        where r.user_id = v_staff and r.permission = u.p)
      order by u.n)));
end;
$$;

/** The first owner, set up once by a person with the secret key (the
 * `staff:bootstrap` script). Refused as soon as any staff exist. */
create function private.bootstrap_owner(p_user_id uuid, p_display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(hashtext('private.staff_members'));
  if exists (select 1 from private.staff_members) then
    raise exception 'staff already exist: add people through an approved request'
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.workspace_members where user_id = p_user_id) then
    raise exception 'this account belongs to a customer workspace; use a staff-only account'
      using errcode = 'P0001';
  end if;
  insert into private.staff_members (user_id, role, display_name)
  values (p_user_id, 'owner', p_display_name);
  perform private.log_admin_action(
    p_user_id, 'staff.bootstrap', 'succeeded', 'first owner', 'staff', p_user_id::text,
    null, null, '{}'::jsonb);
end;
$$;

create function public.admin_bootstrap_owner(p_user_id uuid, p_display_name text)
returns void
language sql
security definer
set search_path = ''
as $$ select private.bootstrap_owner(p_user_id, p_display_name); $$;

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------

-- Nothing in `private` is reachable from the API, and the audit log can't
-- be changed through it even with the secret key.
revoke all on all tables in schema private from public, anon, authenticated, service_role;
revoke all on all functions in schema private from public, anon, authenticated, service_role;

revoke all on function public.admin_request_change(text, text, text, jsonb, text) from public, anon;
revoke all on function public.admin_decide_change(uuid, boolean, text) from public, anon;
revoke all on function public.admin_apply_staff_change(uuid) from public, anon;
revoke all on function public.admin_whoami() from public, anon;
grant execute on function public.admin_request_change(text, text, text, jsonb, text) to authenticated;
grant execute on function public.admin_decide_change(uuid, boolean, text) to authenticated;
grant execute on function public.admin_apply_staff_change(uuid) to authenticated;
grant execute on function public.admin_whoami() to authenticated;

-- Service role only: the verification job and the bootstrap script.
revoke all on function public.admin_verify_audit_chain() from public, anon, authenticated;
revoke all on function public.admin_bootstrap_owner(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_verify_audit_chain() to service_role;
grant execute on function public.admin_bootstrap_owner(uuid, text) to service_role;

alter table private.staff_members enable row level security;
alter table private.staff_permission_removals enable row level security;
alter table private.platform_audit_log enable row level security;
alter table private.change_requests enable row level security;

-- ---------------------------------------------------------------------------
-- 7. Reading the trail, and break-glass
-- ---------------------------------------------------------------------------

/** The latest audit entries, newest first (staff with audit.read). */
create function public.admin_read_audit(p_limit integer default 50, p_before bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_staff uuid := private.check_staff('audit.read');
begin
  if v_staff is null then return private.denial(); end if;
  return jsonb_build_object('ok', true, 'entries', coalesce((
    select jsonb_agg(to_jsonb(e) - 'prev_hash' - 'row_hash' order by e.id desc)
    from (
      select l.id, l.at, l.staff_id, l.actor_user_id, l.action, l.outcome, l.reason,
             l.target_type, l.target_id, l.workspace_id, l.approval_id, l.ip, l.details,
             l.prev_hash, l.row_hash
      from private.platform_audit_log l
      where p_before is null or l.id < p_before
      order by l.id desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) e
  ), '[]'::jsonb));
end;
$$;

/**
 * Break-glass: an owner approves a request with no second person, for
 * when there is no other approver (the second staff member, an outage).
 * Needs a fresh second factor and a reason; it's recorded as an
 * emergency for every owner to review.
 */
create function public.admin_emergency_approve(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_staff uuid := private.check_staff('staff.manage', true);
  v_req private.change_requests;
begin
  if v_staff is null then return private.denial(); end if;
  if not exists (select 1 from private.staff_members where user_id = v_staff and role = 'owner') then
    return jsonb_build_object('ok', false, 'code', 'denied');
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 10 and 500 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  select * into v_req from private.change_requests where id = p_id for update;
  if not found or v_req.status <> 'pending' or v_req.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'not_pending');
  end if;
  update private.change_requests
     set status = 'approved', emergency = true, decided_at = now(),
         decision_note = 'EMERGENCY: ' || btrim(p_reason)
   where id = p_id;
  perform private.log_admin_action(
    v_staff, 'change.emergency_approved', 'succeeded', btrim(p_reason), v_req.target_type,
    v_req.target_id, null, p_id, jsonb_build_object('action', v_req.action));
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_read_audit(integer, bigint) from public, anon;
revoke all on function public.admin_emergency_approve(uuid, text) from public, anon;
grant execute on function public.admin_read_audit(integer, bigint) to authenticated;
grant execute on function public.admin_emergency_approve(uuid, text) to authenticated;

/** Staff, for the staff page (staff.manage). */
create function public.admin_list_staff()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_staff uuid := private.check_staff('staff.manage');
begin
  if v_staff is null then return private.denial(); end if;
  return jsonb_build_object('ok', true, 'staff', coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', s.user_id, 'email', u.email, 'display_name', s.display_name,
      'role', s.role, 'status', s.status, 'created_at', s.created_at,
      'second_factor', exists (
        select 1 from auth.mfa_factors f where f.user_id = s.user_id and f.status = 'verified')
    ) order by s.created_at)
    from private.staff_members s join auth.users u on u.id = s.user_id
  ), '[]'::jsonb));
end;
$$;

/** Change requests, newest first (anyone who may approve, or manage staff). */
create function public.admin_list_change_requests(p_status text default 'pending')
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_staff uuid := private.check_staff('portal.access');
begin
  if v_staff is null then return private.denial(); end if;
  if not (private.staff_has(v_staff, 'approvals.decide') or private.staff_has(v_staff, 'staff.manage')) then
    perform private.log_admin_action(v_staff, 'approvals.read', 'denied', null, null, null, null, null, '{}'::jsonb);
    return jsonb_build_object('ok', false, 'code', 'denied');
  end if;
  update private.change_requests set status = 'expired'
   where status in ('pending', 'approved') and expires_at <= now();
  return jsonb_build_object('ok', true, 'requests', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'action', r.action, 'target_type', r.target_type, 'target_id', r.target_id,
      'target_email', (select u.email from auth.users u where u.id::text = r.target_id),
      'payload', r.payload, 'reason', r.reason, 'requested_by', r.requested_by,
      'requested_by_name', (select m.display_name from private.staff_members m where m.user_id = r.requested_by),
      'requested_at', r.requested_at, 'expires_at', r.expires_at, 'status', r.status,
      'decided_by', r.decided_by, 'decided_at', r.decided_at, 'emergency', r.emergency,
      'mine', r.requested_by = v_staff
    ) order by r.requested_at desc)
    from private.change_requests r
    where p_status is null or r.status = p_status
    limit 100
  ), '[]'::jsonb));
end;
$$;

/** A staff account's user id from its email, for adding staff (staff.manage). */
create function public.admin_find_account(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_staff uuid := private.check_staff('staff.manage');
  v_id uuid;
begin
  if v_staff is null then return private.denial(); end if;
  select id into v_id from auth.users where lower(email) = lower(btrim(p_email));
  if v_id is null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'user_id', v_id,
    'customer', exists (select 1 from public.workspace_members m where m.user_id = v_id),
    'staff', exists (select 1 from private.staff_members m where m.user_id = v_id));
end;
$$;

revoke all on function public.admin_list_staff() from public, anon;
revoke all on function public.admin_list_change_requests(text) from public, anon;
revoke all on function public.admin_find_account(text) from public, anon;
grant execute on function public.admin_list_staff() to authenticated;
grant execute on function public.admin_list_change_requests(text) to authenticated;
grant execute on function public.admin_find_account(text) to authenticated;
revoke all on private.staff_session_activity from public, anon, authenticated, service_role;
alter table private.staff_session_activity enable row level security;

/** Whether the audit chain is whole, for the audit page (audit.read). */
create function public.admin_audit_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '15s'
as $$
declare
  v_staff uuid := private.check_staff('audit.read');
  v record;
begin
  if v_staff is null then return private.denial(); end if;
  select * into v from public.admin_verify_audit_chain();
  return jsonb_build_object('ok', true, 'first_broken_id', v.first_broken_id,
    'entries', v.entries, 'head_hash', v.head_hash);
end;
$$;
revoke all on function public.admin_audit_status() from public, anon;
grant execute on function public.admin_audit_status() to authenticated;
