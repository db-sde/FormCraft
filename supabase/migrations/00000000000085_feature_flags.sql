-- Feature switches (developer spec 26 Nov 2026, release checklist): each of
-- the new features has a switch staff can turn off for everyone or for one
-- workspace, at once, with a reason that's logged. All start on (decided
-- 26 Nov 2026: archiving, SEO and the font library were already live).

create table public.feature_flags (
  key text primary key check (key in ('form_archiving', 'link_preview_seo', 'api_free',
                                      'font_library', 'email_templates', 'checkout')),
  enabled boolean not null default true,
  reason text check (reason is null or char_length(reason) <= 500),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.feature_flags (key) values
  ('form_archiving'), ('link_preview_seo'), ('api_free'), ('font_library'),
  ('email_templates'), ('checkout');

create table public.feature_flag_overrides (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  key text not null references public.feature_flags (key) on delete cascade,
  enabled boolean not null,
  reason text check (reason is null or char_length(reason) <= 500),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, key)
);

alter table public.feature_flags enable row level security;
alter table public.feature_flag_overrides enable row level security;
revoke all on public.feature_flags, public.feature_flag_overrides from anon, authenticated;
grant all on public.feature_flags, public.feature_flag_overrides to service_role;

/** Whether a feature is on for a workspace: its override, else the
 * global switch. Unknown keys are on. */
create function public.feature_enabled(p_key text, p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select o.enabled from public.feature_flag_overrides o
      where o.key = p_key and o.workspace_id = p_workspace_id),
    (select f.enabled from public.feature_flags f where f.key = p_key),
    true);
$$;
revoke all on function public.feature_enabled(text, uuid) from public, anon, authenticated;
grant execute on function public.feature_enabled(text, uuid) to service_role;

/** The switches and overrides, for the admin portal. */
create function public.admin_list_feature_flags()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := private.check_staff('ops.read');
begin
  if v_staff is null then return private.denial(); end if;
  return jsonb_build_object(
    'ok', true,
    'flags', coalesce((select jsonb_agg(jsonb_build_object(
        'key', f.key, 'enabled', f.enabled, 'reason', f.reason, 'updated_at', f.updated_at)
        order by f.key) from public.feature_flags f), '[]'::jsonb),
    'overrides', coalesce((select jsonb_agg(jsonb_build_object(
        'workspace_id', o.workspace_id, 'workspace', w.name, 'key', o.key,
        'enabled', o.enabled, 'reason', o.reason, 'updated_at', o.updated_at)
        order by o.updated_at desc)
        from public.feature_flag_overrides o join public.workspaces w on w.id = o.workspace_id),
      '[]'::jsonb));
end;
$$;

/** Turns a feature on or off for everyone, or for one workspace (null
 * p_enabled with a workspace clears its override). Takes effect at once;
 * one staff member may do it, with a reason. Turning a feature off for
 * everyone raises an alert. */
create function public.admin_set_feature_flag(
  p_key text,
  p_enabled boolean,
  p_workspace_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_staff uuid := private.check_staff('ops.record', true);
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_staff is null then return private.denial(); end if;
  if char_length(v_reason) not between 5 and 500 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  if not exists (select 1 from public.feature_flags where key = p_key) then
    return jsonb_build_object('ok', false, 'code', 'unknown_flag');
  end if;
  if p_workspace_id is null then
    if p_enabled is null then
      return jsonb_build_object('ok', false, 'code', 'invalid');
    end if;
    update public.feature_flags
       set enabled = p_enabled, reason = v_reason, updated_by = v_staff, updated_at = now()
     where key = p_key;
    if p_enabled then
      if exists (select 1 from private.ops_alerts
                  where kind = 'feature_off:' || p_key and resolved_at is null) then
        perform private.resolve_alert('feature_off:' || p_key);
      end if;
    else
      perform private.raise_alert('feature_off:' || p_key, 'warning',
        format('%s is switched off for every customer: %s', p_key, v_reason),
        jsonb_build_object('staff_id', v_staff));
    end if;
  else
    if not exists (select 1 from public.workspaces where id = p_workspace_id) then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    if p_enabled is null then
      delete from public.feature_flag_overrides
       where workspace_id = p_workspace_id and key = p_key;
    else
      insert into public.feature_flag_overrides as o
        (workspace_id, key, enabled, reason, updated_by)
      values (p_workspace_id, p_key, p_enabled, v_reason, v_staff)
      on conflict (workspace_id, key) do update
        set enabled = excluded.enabled, reason = excluded.reason,
            updated_by = excluded.updated_by, updated_at = now();
    end if;
  end if;
  perform private.log_admin_action(
    v_staff, 'feature.' || case when p_enabled is null then 'cleared'
                                when p_enabled then 'enabled' else 'disabled' end,
    'succeeded', v_reason, 'feature_flag', p_key, p_workspace_id, null, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_list_feature_flags() from public, anon;
grant execute on function public.admin_list_feature_flags() to authenticated;
revoke all on function public.admin_set_feature_flag(text, boolean, uuid, text) from public, anon;
grant execute on function public.admin_set_feature_flag(text, boolean, uuid, text) to authenticated;
