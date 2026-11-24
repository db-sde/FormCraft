-- Super Admin, Phase 1 (docs/super-admin-design.md §3.7–3.8): the
-- customer directory and 360 view, account status (restricted /
-- suspended) enforced in the database, and plan and entitlement changes
-- through approved requests. Billing-provider sync comes once a provider
-- is chosen.

-- ---------------------------------------------------------------------------
-- 1. Account status
-- ---------------------------------------------------------------------------

alter table public.workspaces
  add column status text not null default 'active'
    check (status in ('active', 'restricted', 'suspended')),
  -- Shown to the workspace's members; the internal reason lives in the
  -- approved request and the audit trail.
  add column status_message text check (char_length(status_message) <= 500),
  add column status_changed_at timestamptz;

-- Plans, overrides and status change only through an approved admin
-- change (which sets formcraft.admin_apply for its own transaction; the
-- API can't call set_config) or the service role. Members' own writes
-- keep the old values, as before for plans.
create or replace function public.protect_workspace_plan()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     and coalesce(current_setting('formcraft.admin_apply', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      new.plan_id := 'free';
      new.entitlement_overrides := '{}';
      new.status := 'active';
      new.status_message := null;
      new.status_changed_at := null;
    else
      new.plan_id := old.plan_id;
      new.entitlement_overrides := old.entitlement_overrides;
      new.status := old.status;
      new.status_message := old.status_message;
      new.status_changed_at := old.status_changed_at;
    end if;
  end if;
  return new;
end;
$$;

create function public.workspace_status(p_workspace_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select status from public.workspaces where id = p_workspace_id), 'active');
$$;

create function public.form_workspace_status(p_form_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select w.status from public.forms f join public.workspaces w on w.id = f.workspace_id
    where f.id = p_form_id), 'active');
$$;
revoke all on function public.workspace_status(uuid) from public, anon;
revoke all on function public.form_workspace_status(uuid) from public, anon;
grant execute on function public.workspace_status(uuid) to authenticated, service_role;
grant execute on function public.form_workspace_status(uuid) to authenticated, service_role;

-- A suspended workspace is read-only for its members: on every table that
-- belongs to a workspace (or to one of its forms), members' inserts,
-- updates and deletes are refused. Reading (and exporting) still works.
do $$
declare t record;
begin
  for t in
    select c.table_name, bool_or(c.column_name = 'workspace_id') as by_workspace
    from information_schema.columns c
    join pg_tables p on p.schemaname = c.table_schema and p.tablename = c.table_name
    where c.table_schema = 'public' and p.rowsecurity
      and c.column_name in ('workspace_id', 'form_id')
      and c.table_name not in ('workspaces')
    group by c.table_name
  loop
    execute format(
      'create policy "status: suspended is read-only (insert)" on public.%I as restrictive
         for insert to authenticated with check (%s <> ''suspended'')',
      t.table_name,
      case when t.by_workspace then 'public.workspace_status(workspace_id)'
           else 'public.form_workspace_status(form_id)' end);
    execute format(
      'create policy "status: suspended is read-only (update)" on public.%I as restrictive
         for update to authenticated using (%s <> ''suspended'') with check (%s <> ''suspended'')',
      t.table_name,
      case when t.by_workspace then 'public.workspace_status(workspace_id)'
           else 'public.form_workspace_status(form_id)' end,
      case when t.by_workspace then 'public.workspace_status(workspace_id)'
           else 'public.form_workspace_status(form_id)' end);
    execute format(
      'create policy "status: suspended is read-only (delete)" on public.%I as restrictive
         for delete to authenticated using (%s <> ''suspended'')',
      t.table_name,
      case when t.by_workspace then 'public.workspace_status(workspace_id)'
           else 'public.form_workspace_status(form_id)' end);
  end loop;
end;
$$;

-- Restricted: no new forms (and, in the app, no publishing).
create policy "status: restricted makes no new forms" on public.forms as restrictive
  for insert to authenticated
  with check (public.workspace_status(workspace_id) = 'active');

-- A suspended workspace's forms take no responses, whatever path tries.
create function private.refuse_suspended_responses()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or (new.status = 'completed' and old.status <> 'completed'))
     and public.form_workspace_status(new.form_id) = 'suspended' then
    raise exception 'workspace_suspended' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger responses_not_while_suspended
  before insert or update of status on public.responses
  for each row execute function private.refuse_suspended_responses();
revoke all on function private.refuse_suspended_responses() from public, anon, authenticated, service_role;

-- Publishing needs an active workspace, whatever calls it (publishing
-- runs with the service role, past row-level security). Unpublishing
-- still works.
create function private.refuse_inactive_publish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from 'published')
     and public.form_workspace_status(new.form_id) <> 'active' then
    raise exception 'workspace_not_active' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger form_versions_publish_needs_active
  before insert or update of status on public.form_versions
  for each row execute function private.refuse_inactive_publish();
revoke all on function private.refuse_inactive_publish() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Entitlements: the keys and kinds (kept equal to ENTITLEMENT_DEFAULTS
--    in src/domains/billing/entitlements.ts by a unit test)
-- ---------------------------------------------------------------------------

create function private.entitlement_kinds()
returns table (key text, kind text)
language sql
immutable
set search_path = ''
as $$
  select * from (values
    ('responses_per_month', 'limit'), ('members', 'limit'), ('upload_mb', 'limit'),
    ('storage_mb', 'limit'), ('remove_branding', 'feature'), ('custom_domains', 'limit'),
    ('custom_fonts', 'feature'), ('confirmation_emails', 'feature'),
    ('popup_embeds', 'feature'), ('tracking_pixels', 'feature'), ('slack', 'feature'),
    ('crm', 'feature'), ('payments', 'feature'), ('scheduling', 'feature'),
    ('multilingual', 'feature'), ('ai_credits_per_month', 'limit'),
    ('api_access', 'feature'), ('ab_testing', 'feature'), ('sso', 'feature'),
    ('scim', 'feature'), ('data_lookups', 'feature')
  ) e(key, kind);
$$;

/** An entitlements object FormCraft understands: known keys only, a
 * feature is true/false, a limit is a whole number ≥ 0 or null
 * (unlimited). */
create function private.valid_entitlements(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'object' and not exists (
    select 1 from jsonb_each(p) e
    left join private.entitlement_kinds() k on k.key = e.key
    where k.key is null
       or (k.kind = 'feature' and jsonb_typeof(e.value) <> 'boolean')
       or (k.kind = 'limit' and not (
             jsonb_typeof(e.value) = 'null'
             or (jsonb_typeof(e.value) = 'number'
                 and (e.value #>> '{}')::numeric >= 0
                 and (e.value #>> '{}')::numeric = trunc((e.value #>> '{}')::numeric)
                 and (e.value #>> '{}')::numeric <= 1000000000)))
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. Approval rules for the new high-risk actions
-- ---------------------------------------------------------------------------

create or replace function private.change_rules(p_action text)
returns table (request_permission text, approve_permission text, approver_roles text[])
language sql
immutable
set search_path = ''
as $$
  select r.request_permission, r.approve_permission, r.approver_roles from (values
    ('staff.add', 'staff.manage', 'approvals.decide', array['owner', 'admin']),
    ('staff.set_role', 'staff.manage', 'approvals.decide', array['owner', 'admin']),
    ('staff.disable', 'staff.manage', 'approvals.decide', array['owner', 'admin']),
    ('workspace.status', 'customers.status', 'approvals.decide', array['owner', 'admin']),
    ('workspace.plan', 'plans.change', 'approvals.decide', array['owner', 'admin', 'billing']),
    ('plan.update', 'plans.change', 'approvals.decide', array['owner', 'admin'])
  ) r(action, request_permission, approve_permission, approver_roles)
  where r.action = p_action;
$$;

-- Support may ask for status changes (approved by owner/admin): give the
-- request permission without the power to decide.
create or replace function private.role_permissions(p_role text)
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
    when 'support' then array[
      'portal.access', 'customers.read', 'customers.status', 'plans.read', 'ops.read']
    when 'billing' then array[
      'portal.access', 'customers.read', 'plans.read', 'plans.change', 'approvals.decide']
    when 'privacy' then array[
      'portal.access', 'customers.read', 'privacy.manage', 'approvals.decide']
    when 'read_only' then array['portal.access', 'customers.read', 'plans.read', 'ops.read']
    else array[]::text[]
  end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Customers: directory and 360
-- ---------------------------------------------------------------------------

create index if not exists workspaces_name_trgm_idx
  on public.workspaces using gin (lower(name) extensions.gin_trgm_ops);
create index if not exists workspaces_slug_trgm_idx
  on public.workspaces using gin (slug extensions.gin_trgm_ops);

/** Workspaces matching a name, slug, member email or custom domain. */
create function public.admin_search_customers(
  p_query text,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_staff uuid := private.check_staff('customers.read');
  v_q text := lower(btrim(coalesce(p_query, '')));
  v_rows jsonb;
begin
  if v_staff is null then return private.denial(); end if;
  if char_length(v_q) < 2 then
    return jsonb_build_object('ok', false, 'code', 'query_too_short');
  end if;
  v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.created_at desc), '[]'::jsonb)
    into v_rows
  from (
    select w.id, w.name, w.slug, w.plan_id, w.status, w.created_at,
      (select u.email from auth.users u where u.id = w.owner_id) as owner_email,
      (select count(*) from public.workspace_members m where m.workspace_id = w.id) as members,
      (select count(*) from public.forms f where f.workspace_id = w.id and f.deleted_at is null)
        as forms
    from public.workspaces w
    where lower(w.name) like '%' || v_q || '%'
       or w.slug like '%' || v_q || '%'
       or w.id::text = v_q
       or exists (
         select 1 from public.workspace_members m join auth.users u on u.id = m.user_id
         where m.workspace_id = w.id and lower(u.email) like '%' || v_q || '%')
       or exists (
         select 1 from public.custom_domains d
         where d.workspace_id = w.id and lower(d.hostname) like '%' || v_q || '%')
    order by w.created_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0)
  ) r;
  perform private.log_admin_action(
    v_staff, 'customers.searched', 'succeeded', null, null, null, null, null,
    jsonb_build_object('query', left(btrim(p_query), 120)));
  return jsonb_build_object('ok', true, 'customers', v_rows);
end;
$$;

/** One workspace, everything support needs and nothing it doesn't: no
 * answers, file contents or secrets. Viewing it is recorded. */
create function public.admin_customer_profile(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '8s'
as $$
declare
  v_staff uuid := private.check_staff('customers.read');
  v_ws public.workspaces;
  v_period date := date_trunc('month', now() at time zone 'UTC')::date;
begin
  if v_staff is null then return private.denial(); end if;
  select * into v_ws from public.workspaces where id = p_workspace_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  perform private.log_admin_action(
    v_staff, 'customer.viewed', 'succeeded', null, 'workspace', p_workspace_id::text,
    p_workspace_id, null, '{}'::jsonb);
  return jsonb_build_object(
    'ok', true,
    'workspace', jsonb_build_object(
      'id', v_ws.id, 'name', v_ws.name, 'slug', v_ws.slug, 'created_at', v_ws.created_at,
      'plan_id', v_ws.plan_id, 'overrides', v_ws.entitlement_overrides,
      'status', v_ws.status, 'status_message', v_ws.status_message,
      'status_changed_at', v_ws.status_changed_at),
    'plan', (select jsonb_build_object('id', p.id, 'name', p.name, 'entitlements', p.entitlements)
             from public.plans p where p.id = v_ws.plan_id),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'email', u.email, 'role', m.role, 'joined_at', m.created_at,
        'last_sign_in_at', u.last_sign_in_at,
        'second_factor', exists (
          select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified'))
        order by m.created_at)
      from public.workspace_members m join auth.users u on u.id = m.user_id
      where m.workspace_id = p_workspace_id), '[]'::jsonb),
    'usage', coalesce((
      select jsonb_object_agg(c.metric, c.value) from public.usage_counters c
      where c.workspace_id = p_workspace_id and c.period_start = v_period), '{}'::jsonb),
    'counts', jsonb_build_object(
      'forms', (select count(*) from public.forms f
                where f.workspace_id = p_workspace_id and f.deleted_at is null),
      'live_forms', (select count(*) from public.forms f
                     join public.form_versions v on v.form_id = f.id and v.status = 'published'
                     where f.workspace_id = p_workspace_id and f.deleted_at is null),
      'responses', (select count(*) from public.responses r join public.forms f on f.id = r.form_id
                    where f.workspace_id = p_workspace_id and r.status = 'completed'
                      and not r.is_preview),
      'responses_30d', (select count(*) from public.responses r
                        join public.forms f on f.id = r.form_id
                        where f.workspace_id = p_workspace_id and r.status = 'completed'
                          and not r.is_preview and r.completed_at > now() - interval '30 days'),
      'storage_bytes', (select coalesce(sum(up.size_bytes), 0) from public.uploads up
                        join public.responses r on r.id = up.response_id
                        join public.forms f on f.id = r.form_id
                        where f.workspace_id = p_workspace_id and up.status <> 'deleted')),
    'integrations', jsonb_build_object(
      'webhooks', coalesce((select jsonb_object_agg(k.kind, k.n) from (
                    select we.kind, count(*) as n from public.webhook_endpoints we
                    join public.forms f on f.id = we.form_id
                    where f.workspace_id = p_workspace_id group by we.kind) k), '{}'::jsonb),
      'connections', coalesce((select jsonb_agg(distinct c.provider)
                      from public.integration_credentials c
                      where c.workspace_id = p_workspace_id), '[]'::jsonb),
      'custom_domains', coalesce((select jsonb_agg(d.hostname) from public.custom_domains d
                         where d.workspace_id = p_workspace_id), '[]'::jsonb)),
    'recent_activity', coalesce((
      select jsonb_agg(jsonb_build_object('at', a.created_at, 'action', a.action,
                                          'outcome', a.outcome) order by a.created_at desc)
      from (select * from public.audit_logs a where a.workspace_id = p_workspace_id
            order by a.created_at desc limit 20) a), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'action', r.action, 'status', r.status,
                                          'requested_at', r.requested_at, 'payload', r.payload)
                       order by r.requested_at desc)
      from private.change_requests r
      where r.target_type = 'workspace' and r.target_id = p_workspace_id::text), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Plans
-- ---------------------------------------------------------------------------

create function public.admin_list_plans()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_staff uuid := private.check_staff('plans.read');
begin
  if v_staff is null then return private.denial(); end if;
  return jsonb_build_object('ok', true,
    'plans', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'sort_order', p.sort_order, 'entitlements', p.entitlements,
      'workspaces', (select count(*) from public.workspaces w where w.plan_id = p.id))
      order by p.sort_order) from public.plans p), '[]'::jsonb),
    'keys', (select jsonb_agg(jsonb_build_object('key', k.key, 'kind', k.kind))
             from private.entitlement_kinds() k));
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Applying approved customer and plan changes
-- ---------------------------------------------------------------------------

create function public.admin_apply_change(p_request_id uuid)
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
  v_ws public.workspaces;
  v_p jsonb;
begin
  -- Staff at all before anything is read; then the action's own permission.
  v_staff := private.check_staff('portal.access');
  if v_staff is null then return private.denial(); end if;
  select * into v_req from private.change_requests where id = p_request_id;
  if not found or v_req.action not in ('workspace.status', 'workspace.plan', 'plan.update') then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into v_rule from private.change_rules(v_req.action);
  -- Whoever may ask for it may carry out the approved change.
  v_staff := private.check_staff(v_rule.request_permission, true);
  if v_staff is null then return private.denial(); end if;
  if private.consume_approval(p_request_id, v_req.action, v_req.target_id, v_req.payload) is null then
    perform private.log_admin_action(
      v_staff, v_req.action, 'denied', 'no approved request', v_req.target_type,
      v_req.target_id, null, p_request_id, '{}'::jsonb);
    return jsonb_build_object('ok', false, 'code', 'approval_required');
  end if;
  v_p := v_req.payload;
  perform pg_catalog.set_config('formcraft.admin_apply', 'on', true);

  if v_req.action = 'plan.update' then
    if not private.valid_entitlements(v_p -> 'entitlements')
       or not exists (select 1 from public.plans where id = v_req.target_id) then
      raise exception 'invalid_entitlements' using errcode = 'P0001';
    end if;
    update public.plans set entitlements = v_p -> 'entitlements' where id = v_req.target_id;
  else
    select * into v_ws from public.workspaces where id = v_req.target_id::uuid for update;
    if not found then raise exception 'workspace_not_found' using errcode = 'P0001'; end if;
    if v_req.action = 'workspace.status' then
      if coalesce(v_p ->> 'status', '') not in ('active', 'restricted', 'suspended') then
        raise exception 'invalid_status' using errcode = 'P0001';
      end if;
      update public.workspaces
         set status = v_p ->> 'status',
             status_message = nullif(left(btrim(coalesce(v_p ->> 'message', '')), 500), ''),
             status_changed_at = now()
       where id = v_ws.id;
    else
      if not exists (select 1 from public.plans where id = v_p ->> 'plan_id')
         or not private.valid_entitlements(coalesce(v_p -> 'overrides', '{}'::jsonb)) then
        raise exception 'invalid_plan' using errcode = 'P0001';
      end if;
      update public.workspaces
         set plan_id = v_p ->> 'plan_id',
             entitlement_overrides = coalesce(v_p -> 'overrides', '{}'::jsonb)
       where id = v_ws.id;
    end if;
    -- The customer sees what FormCraft staff did to their account.
    insert into public.audit_logs (workspace_id, actor_id, action, target_type, target_id,
                                   metadata, reason, outcome)
    values (v_ws.id, null,
            case v_req.action when 'workspace.status' then 'support.status_changed'
                 else 'support.plan_changed' end,
            'workspace', v_ws.id::text,
            jsonb_build_object('by', 'FormCraft support') ||
              case v_req.action when 'workspace.status'
                then jsonb_build_object('from', v_ws.status, 'to', v_p ->> 'status')
                else jsonb_build_object('from', v_ws.plan_id, 'to', v_p ->> 'plan_id') end,
            null, 'succeeded');
  end if;

  perform private.log_admin_action(
    v_staff, v_req.action, 'succeeded', v_req.reason, v_req.target_type, v_req.target_id,
    case when v_req.target_type = 'workspace' then v_req.target_id::uuid end,
    p_request_id, v_p);
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------

revoke all on all functions in schema private from public, anon, authenticated, service_role;
revoke all on function public.admin_search_customers(text, integer, integer) from public, anon;
revoke all on function public.admin_customer_profile(uuid) from public, anon;
revoke all on function public.admin_list_plans() from public, anon;
revoke all on function public.admin_apply_change(uuid) from public, anon;
grant execute on function public.admin_search_customers(text, integer, integer) to authenticated;
grant execute on function public.admin_customer_profile(uuid) to authenticated;
grant execute on function public.admin_list_plans() to authenticated;
grant execute on function public.admin_apply_change(uuid) to authenticated;
