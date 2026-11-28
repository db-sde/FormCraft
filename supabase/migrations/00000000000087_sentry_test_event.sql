-- Super Admin: a test error for Sentry, sent from the Operations page.
--
-- Staff press a button to check that error reporting reaches Sentry. The
-- portal asks this function first: it decides who may (ops.record) and
-- writes the audit entry, with the id the event will carry, so the event
-- in Sentry and the entry in the trail can be matched. Only then does the
-- server send the event. Nothing is stored besides the audit entry.

create function public.admin_log_sentry_test(p_event_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_staff uuid := private.check_staff('ops.record');
begin
  if v_staff is null then return private.denial(); end if;
  if p_event_id is null or p_event_id !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  perform private.log_admin_action(v_staff, 'ops.sentry_test_sent', 'succeeded', null,
    'sentry_event', p_event_id, null, null, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_log_sentry_test(text) from public, anon;
grant execute on function public.admin_log_sentry_test(text) to authenticated;
