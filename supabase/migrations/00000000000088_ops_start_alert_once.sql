-- QA FC15-09: the "owners are now told about every high-risk change"
-- notice was raised again every 5 minutes while the staff audit log had
-- no entries, because its first-run test was "the last audit id seen is
-- 0". The first run is now known by the start alert existing. Nothing
-- else in the function changes.

create or replace function public.ops_phase5_checks()
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
  -- Decided by the start alert itself: "nothing seen yet" (an empty audit
  -- log) used to raise it again on every run (QA FC15-09).
  if not exists (select 1 from private.ops_alerts where kind = 'change_executed:start') then
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


revoke all on function public.ops_phase5_checks() from public, anon, authenticated;
grant execute on function public.ops_phase5_checks() to service_role;
