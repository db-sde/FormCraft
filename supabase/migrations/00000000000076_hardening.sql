-- Super Admin, Phase 5 (docs/super-admin-design.md §4, §5, §7): the
-- remaining protections from the threat model.
--
-- * A staff sign-in from a new address tells owners (stolen password).
-- * Every high-risk change carried out tells owners, not only emergency
--   approvals (two staff working together).
-- * A monthly access review: the owner confirms each staff member still
--   needs their role, with a record and a reminder when one is due.
-- * Drills other than restores (outages, lockouts, incident exercises)
--   are recorded like restore tests, and a missing restore drill raises
--   an alert.

-- ---------------------------------------------------------------------------
-- 1. New sign-in addresses
-- ---------------------------------------------------------------------------

create table private.staff_known_ips (
  user_id uuid not null references private.staff_members (user_id) on delete cascade,
  ip inet not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, ip)
);
alter table private.staff_known_ips enable row level security;

/** Who the caller is in the portal (any staff role). Also remembers the
 * address of the session; a new one for someone with history raises an
 * alert, so owners hear about a sign-in they don't expect. */
create or replace function public.admin_whoami()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_staff uuid := private.check_staff('portal.access');
  v_row private.staff_members;
  v_ip inet;
  v_new boolean;
begin
  if v_staff is null then return private.denial(); end if;
  select * into v_row from private.staff_members where user_id = v_staff;

  select s.ip into v_ip from auth.sessions s
   where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid;
  if v_ip is not null then
    insert into private.staff_known_ips (user_id, ip) values (v_staff, v_ip)
    on conflict (user_id, ip) do update set last_seen_at = now()
    returning (xmax = 0) into v_new;
    if v_new and exists (select 1 from private.staff_known_ips k
                          where k.user_id = v_staff and k.ip <> v_ip) then
      perform private.raise_alert(
        'staff_new_ip:' || v_staff || ':' || host(v_ip), 'warning',
        format('%s signed in to the staff portal from a new address (%s). If that wasn''t '
               'them, disable the account.', v_row.display_name, host(v_ip)),
        jsonb_build_object('staff_id', v_staff, 'ip', host(v_ip)));
      perform private.log_admin_action(
        v_staff, 'staff.new_ip', 'succeeded', null, 'staff', v_staff::text, null, null,
        jsonb_build_object('ip', host(v_ip)));
    end if;
  end if;

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

-- ---------------------------------------------------------------------------
-- 2. Access reviews
-- ---------------------------------------------------------------------------

create table private.access_reviews (
  id bigint generated always as identity primary key,
  reviewed_at timestamptz not null default now(),
  reviewer uuid not null references private.staff_members (user_id),
  notes text check (char_length(notes) <= 2000),
  staff jsonb not null
);
alter table private.access_reviews enable row level security;

/** Everyone with staff access, what they've done lately, and what looks
 * worth a second look. For the owner's monthly review. */
create function public.admin_access_review()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_staff uuid := private.check_staff('staff.manage');
  v_last private.access_reviews;
begin
  if v_staff is null then return private.denial(); end if;
  select * into v_last from private.access_reviews order by reviewed_at desc limit 1;
  return jsonb_build_object(
    'ok', true,
    'now', now(),
    'last_review', case when v_last.id is null then null else jsonb_build_object(
      'reviewed_at', v_last.reviewed_at,
      'reviewer', (select display_name from private.staff_members where user_id = v_last.reviewer),
      'notes', v_last.notes) end,
    'due_at', coalesce(v_last.reviewed_at, (select min(created_at) from private.staff_members))
              + interval '1 month',
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'display_name', m.display_name, 'email', u.email,
        'role', m.role, 'status', m.status, 'added_at', m.created_at,
        'last_seen_at', (select max(a.last_seen_at) from private.staff_session_activity a
                          where a.user_id = m.user_id),
        'actions_30d', (select count(*) from private.platform_audit_log l
                         where l.staff_id = m.user_id and l.outcome = 'succeeded'
                           and l.at > now() - interval '30 days'),
        'denied_30d', (select count(*) from private.platform_audit_log l
                        where l.staff_id = m.user_id and l.outcome = 'denied'
                          and l.at > now() - interval '30 days'),
        'addresses', (select count(*) from private.staff_known_ips k where k.user_id = m.user_id),
        'removed_permissions', coalesce((
          select jsonb_agg(r.permission order by r.permission)
            from private.staff_permission_removals r where r.user_id = m.user_id), '[]'::jsonb))
        order by m.status, m.role, m.display_name)
        from private.staff_members m
        join auth.users u on u.id = m.user_id), '[]'::jsonb)
  );
end;
$$;

/** Records the review: the owner confirms every active staff member was
 * looked at. Changing someone's access still goes through approvals. */
create function public.admin_record_access_review(p_reviewed uuid[], p_notes text)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_staff uuid := private.check_staff('staff.manage', true);
  v_active uuid[];
  v_snapshot jsonb;
  v_id bigint;
begin
  if v_staff is null then return private.denial(); end if;
  select coalesce(array_agg(user_id order by user_id), '{}') into v_active
    from private.staff_members where status = 'active';
  if (select coalesce(array_agg(x order by x), '{}') from (select distinct unnest(p_reviewed) x) d)
     is distinct from v_active then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'why', 'review_incomplete');
  end if;
  select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'display_name', m.display_name,
                                      'role', m.role, 'status', m.status)
                   order by m.display_name)
    into v_snapshot from private.staff_members m;
  insert into private.access_reviews (reviewer, notes, staff)
  values (v_staff, nullif(btrim(coalesce(p_notes, '')), ''), v_snapshot)
  returning id into v_id;
  perform private.resolve_alert('access_review_due');
  perform private.log_admin_action(
    v_staff, 'staff.access_reviewed', 'succeeded', nullif(btrim(coalesce(p_notes, '')), ''),
    'access_review', v_id::text, null, null,
    jsonb_build_object('staff', cardinality(v_active)));
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Drills
-- ---------------------------------------------------------------------------

create table private.ops_drills (
  id bigint generated always as identity primary key,
  kind text not null check (kind in (
    'webhook_outage', 'email_outage', 'scheduler_outage', 'ai_outage',
    'staff_lockout', 'secret_rotation', 'incident_exercise')),
  ran_at timestamptz not null default now(),
  scenario text not null check (char_length(scenario) between 5 and 1000),
  outcome text not null check (char_length(outcome) between 5 and 2000),
  succeeded boolean not null,
  follow_ups text check (char_length(follow_ups) <= 2000),
  evidence_url text check (evidence_url is null or evidence_url ~ '^https://'),
  recorded_by uuid not null references private.staff_members (user_id)
);
alter table private.ops_drills enable row level security;

/** Records a drill other than a restore (those have their own record). */
create function public.admin_record_drill(
  p_kind text,
  p_scenario text,
  p_outcome text,
  p_succeeded boolean,
  p_follow_ups text,
  p_evidence_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_staff uuid := private.check_staff('ops.record');
  v_id bigint;
begin
  if v_staff is null then return private.denial(); end if;
  begin
    insert into private.ops_drills (kind, scenario, outcome, succeeded, follow_ups,
                                    evidence_url, recorded_by)
    values (p_kind, btrim(p_scenario), btrim(p_outcome), coalesce(p_succeeded, false),
            nullif(btrim(coalesce(p_follow_ups, '')), ''),
            nullif(btrim(coalesce(p_evidence_url, '')), ''), v_staff)
    returning id into v_id;
  exception when check_violation then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end;
  perform private.log_admin_action(
    v_staff, 'ops.drill_recorded', 'succeeded', null, 'drill', v_id::text, null, null,
    jsonb_build_object('kind', p_kind, 'succeeded', p_succeeded));
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create function public.admin_list_drills()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_staff uuid := private.check_staff('ops.read');
begin
  if v_staff is null then return private.denial(); end if;
  return jsonb_build_object('ok', true, 'drills', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'kind', d.kind, 'ran_at', d.ran_at, 'scenario', d.scenario,
      'outcome', d.outcome, 'succeeded', d.succeeded, 'follow_ups', d.follow_ups,
      'evidence_url', d.evidence_url, 'recorded_by', s.display_name) order by d.ran_at desc)
      from (select * from private.ops_drills order by ran_at desc limit 50) d
      left join private.staff_members s on s.user_id = d.recorded_by), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Checks and notices for owners
-- ---------------------------------------------------------------------------

/** Every 5 minutes from the ops job. */
create function public.ops_phase5_checks()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last_seen bigint;
  r record;
  v_due timestamptz;
  v_restore timestamptz;
begin
  -- Each high-risk change carried out (an approved request applied).
  select coalesce(max((details ->> 'audit_id')::bigint), 0) into v_last_seen
    from private.ops_alerts where kind like 'change_executed:%';
  -- The first run starts from now rather than telling owners about history.
  if v_last_seen = 0 then
    select coalesce(max(id), 0) into v_last_seen from private.platform_audit_log;
    perform private.raise_alert('change_executed:start', 'info',
      'Owners are now told about every high-risk change carried out.',
      jsonb_build_object('audit_id', v_last_seen));
  end if;
  for r in
    select l.id, l.action, l.reason, l.target_type, l.target_id, s.display_name
      from private.platform_audit_log l
      left join private.staff_members s on s.user_id = l.staff_id
     where l.id > v_last_seen and l.approval_id is not null and l.outcome = 'succeeded'
       and l.action not like 'change.%'
     order by l.id
  loop
    perform private.raise_alert('change_executed:' || r.id, 'info',
      format('%s carried out %s on %s %s: "%s".', coalesce(r.display_name, 'Staff'),
             r.action, coalesce(r.target_type, ''), coalesce(r.target_id, ''),
             coalesce(r.reason, '')),
      jsonb_build_object('audit_id', r.id));
  end loop;

  -- The monthly access review.
  select coalesce(max(reviewed_at), (select min(created_at) from private.staff_members))
         + interval '1 month'
    into v_due from private.access_reviews;
  if v_due is not null and v_due < now() then
    perform private.raise_alert('access_review_due', 'warning',
      'The monthly staff access review is due: an owner confirms each person still needs '
      'their role (Staff → Access review).', '{}'::jsonb);
  else
    perform private.resolve_alert('access_review_due');
  end if;

  -- A restore drill at least every 90 days, once there is staff to run one.
  select max(tested_at) into v_restore from private.restore_tests where succeeded;
  if exists (select 1 from private.staff_members
              where created_at < now() - interval '90 days')
     and (v_restore is null or v_restore < now() - interval '90 days') then
    perform private.raise_alert('restore_drill_overdue', 'warning',
      'No successful restore drill in the last 90 days. Restore a backup into a spare '
      'project and record it on Operations.', '{}'::jsonb);
  else
    perform private.resolve_alert('restore_drill_overdue');
  end if;
end;
$$;

/** One-off notices are told once, then closed. */
create or replace function public.ops_mark_notified(p_ids bigint[])
returns void
language sql
security definer
set search_path = ''
as $$
  update private.ops_alerts set notified_at = now() where id = any (p_ids);
  update private.ops_alerts set resolved_at = now()
   where id = any (p_ids) and resolved_at is null
     and (kind like 'emergency_approval:%' or kind like 'change_executed:%'
          or kind like 'staff_new_ip:%');
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------

revoke all on function public.ops_phase5_checks() from public, anon, authenticated;
grant execute on function public.ops_phase5_checks() to service_role;

revoke all on function public.admin_access_review() from public, anon;
revoke all on function public.admin_record_access_review(uuid[], text) from public, anon;
revoke all on function public.admin_record_drill(text, text, text, boolean, text, text)
  from public, anon;
revoke all on function public.admin_list_drills() from public, anon;
grant execute on function public.admin_access_review() to authenticated;
grant execute on function public.admin_record_access_review(uuid[], text) to authenticated;
grant execute on function public.admin_record_drill(text, text, text, boolean, text, text)
  to authenticated;
grant execute on function public.admin_list_drills() to authenticated;
