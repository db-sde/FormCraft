-- Plans and quotas (pricing doc "FormCraft Pricing Plans & Unit
-- Economics", 26 Nov 2026): four public plans (Free, Starter, Pro,
-- Business) plus Enterprise for custom contracts, prices, the full list
-- of features by plan, and the quotas that keep every plan above its cost:
-- notification emails, address lookups, AI credits priced by model,
-- storage, recording length, bookings and the API.
--
-- The plan rows are generated from src/domains/billing/catalog.ts; a unit
-- test keeps them equal. Staff can still change a plan later through an
-- approved request (Super Admin), so the app reads these rows at run time.

-- ---------------------------------------------------------------------------
-- 1. Prices and listing
-- ---------------------------------------------------------------------------

alter table public.plans
  add column monthly_usd numeric(8, 2) check (monthly_usd >= 0),
  add column annual_usd numeric(8, 2) check (annual_usd >= 0),
  add column is_public boolean not null default false,
  add column tagline text check (char_length(tagline) <= 120);

-- ---------------------------------------------------------------------------
-- 2. Entitlement keys (kept equal to ENTITLEMENT_DEFAULTS by a unit test)
-- ---------------------------------------------------------------------------

create or replace function private.entitlement_kinds()
returns table (key text, kind text)
language sql
immutable
set search_path = ''
as $$
  select * from (values
    ('responses_per_month', 'limit'), ('members', 'limit'), ('upload_mb', 'limit'),
    ('storage_mb', 'limit'), ('custom_domains', 'limit'), ('ai_credits_per_month', 'limit'),
    ('emails_per_month', 'limit'), ('address_lookups_per_month', 'limit'), ('recording_seconds', 'limit'),
    ('booking_types', 'limit'), ('api_requests_per_minute', 'limit'), ('api_requests_per_day', 'limit'),
    ('api_keys', 'limit'), ('popup_embeds', 'feature'), ('multilingual', 'feature'),
    ('scheduling', 'feature'), ('slack', 'feature'), ('payments', 'feature'),
    ('api_access', 'feature'), ('remove_branding', 'feature'), ('custom_fonts', 'feature'),
    ('custom_seo', 'feature'), ('email_templates', 'feature'), ('confirmation_emails', 'feature'),
    ('tracking_pixels', 'feature'), ('calendar_sync', 'feature'), ('business_apps', 'feature'),
    ('partial_responses', 'feature'), ('advanced_analytics', 'feature'), ('pdf_documents', 'feature'),
    ('ai_form_tools', 'feature'), ('folders', 'feature'), ('advanced_pixels', 'feature'),
    ('team_hosts', 'feature'), ('crm', 'feature'), ('ai_insights', 'feature'),
    ('advanced_reports', 'feature'), ('response_workflow', 'feature'), ('submission_editing', 'feature'),
    ('team_notifications', 'feature'), ('block_library', 'feature'), ('advanced_logic', 'feature'),
    ('data_lookups', 'feature'), ('dynamic_themes', 'feature'), ('embed_controls', 'feature'),
    ('ab_testing', 'feature'), ('email_otp', 'feature'), ('multiple_workspaces', 'feature'),
    ('granular_permissions', 'feature'), ('audit_log', 'feature'), ('auto_deletion', 'feature'),
    ('sso', 'feature'), ('scim', 'feature')
  ) e(key, kind);
$$;

-- ---------------------------------------------------------------------------
-- 3. The plans
-- ---------------------------------------------------------------------------

insert into public.plans (id, name, sort_order, entitlements, monthly_usd, annual_usd, is_public, tagline)
values
  ('free', 'Free', 0, '{"responses_per_month":5000,"members":1,"upload_mb":10,"storage_mb":1000,"custom_domains":0,"ai_credits_per_month":0,"emails_per_month":500,"address_lookups_per_month":0,"recording_seconds":60,"booking_types":1,"api_requests_per_minute":60,"api_requests_per_day":5000,"api_keys":2,"popup_embeds":true,"multilingual":true,"scheduling":true,"slack":true,"payments":true,"api_access":true,"remove_branding":false,"custom_fonts":false,"custom_seo":false,"email_templates":false,"confirmation_emails":false,"tracking_pixels":false,"calendar_sync":false,"business_apps":false,"partial_responses":false,"advanced_analytics":false,"pdf_documents":false,"ai_form_tools":false,"folders":false,"advanced_pixels":false,"team_hosts":false,"crm":false,"ai_insights":false,"advanced_reports":false,"response_workflow":false,"submission_editing":false,"team_notifications":false,"block_library":false,"advanced_logic":false,"data_lookups":false,"dynamic_themes":false,"embed_controls":false,"ab_testing":false,"email_otp":false,"multiple_workspaces":false,"granular_permissions":false,"audit_log":false,"auto_deletion":false,"sso":false,"scim":false}'::jsonb, 0, 0, true, 'Individuals, students, testing'),
  ('starter', 'Starter', 1, '{"responses_per_month":10000,"members":3,"upload_mb":50,"storage_mb":10000,"custom_domains":1,"ai_credits_per_month":100,"emails_per_month":2000,"address_lookups_per_month":500,"recording_seconds":180,"booking_types":null,"api_requests_per_minute":150,"api_requests_per_day":50000,"api_keys":5,"popup_embeds":true,"multilingual":true,"scheduling":true,"slack":true,"payments":true,"api_access":true,"remove_branding":true,"custom_fonts":true,"custom_seo":true,"email_templates":true,"confirmation_emails":true,"tracking_pixels":true,"calendar_sync":true,"business_apps":true,"partial_responses":true,"advanced_analytics":true,"pdf_documents":true,"ai_form_tools":true,"folders":true,"advanced_pixels":false,"team_hosts":false,"crm":false,"ai_insights":false,"advanced_reports":false,"response_workflow":false,"submission_editing":false,"team_notifications":false,"block_library":false,"advanced_logic":false,"data_lookups":false,"dynamic_themes":false,"embed_controls":false,"ab_testing":false,"email_otp":false,"multiple_workspaces":false,"granular_permissions":false,"audit_log":false,"auto_deletion":false,"sso":false,"scim":false}'::jsonb, 19, 15, true, 'Creators, freelancers, small businesses'),
  ('pro', 'Pro', 2, '{"responses_per_month":25000,"members":10,"upload_mb":100,"storage_mb":50000,"custom_domains":3,"ai_credits_per_month":1000,"emails_per_month":10000,"address_lookups_per_month":2000,"recording_seconds":600,"booking_types":null,"api_requests_per_minute":300,"api_requests_per_day":250000,"api_keys":25,"popup_embeds":true,"multilingual":true,"scheduling":true,"slack":true,"payments":true,"api_access":true,"remove_branding":true,"custom_fonts":true,"custom_seo":true,"email_templates":true,"confirmation_emails":true,"tracking_pixels":true,"calendar_sync":true,"business_apps":true,"partial_responses":true,"advanced_analytics":true,"pdf_documents":true,"ai_form_tools":true,"folders":true,"advanced_pixels":true,"team_hosts":true,"crm":true,"ai_insights":true,"advanced_reports":true,"response_workflow":true,"submission_editing":true,"team_notifications":true,"block_library":true,"advanced_logic":true,"data_lookups":true,"dynamic_themes":true,"embed_controls":true,"ab_testing":true,"email_otp":true,"multiple_workspaces":true,"granular_permissions":true,"audit_log":false,"auto_deletion":false,"sso":false,"scim":false}'::jsonb, 49, 39, true, 'Growing teams, marketers, agencies'),
  ('business', 'Business', 3, '{"responses_per_month":50000,"members":null,"upload_mb":500,"storage_mb":200000,"custom_domains":null,"ai_credits_per_month":2000,"emails_per_month":25000,"address_lookups_per_month":2500,"recording_seconds":600,"booking_types":null,"api_requests_per_minute":1000,"api_requests_per_day":null,"api_keys":null,"popup_embeds":true,"multilingual":true,"scheduling":true,"slack":true,"payments":true,"api_access":true,"remove_branding":true,"custom_fonts":true,"custom_seo":true,"email_templates":true,"confirmation_emails":true,"tracking_pixels":true,"calendar_sync":true,"business_apps":true,"partial_responses":true,"advanced_analytics":true,"pdf_documents":true,"ai_form_tools":true,"folders":true,"advanced_pixels":true,"team_hosts":true,"crm":true,"ai_insights":true,"advanced_reports":true,"response_workflow":true,"submission_editing":true,"team_notifications":true,"block_library":true,"advanced_logic":true,"data_lookups":true,"dynamic_themes":true,"embed_controls":true,"ab_testing":true,"email_otp":true,"multiple_workspaces":true,"granular_permissions":true,"audit_log":true,"auto_deletion":true,"sso":true,"scim":true}'::jsonb, 89, 69, true, 'Larger teams, IT-managed companies'),
  ('enterprise', 'Enterprise', 4, '{"responses_per_month":null,"members":null,"upload_mb":500,"storage_mb":null,"custom_domains":null,"ai_credits_per_month":5000,"emails_per_month":100000,"address_lookups_per_month":10000,"recording_seconds":600,"booking_types":null,"api_requests_per_minute":1000,"api_requests_per_day":null,"api_keys":null,"popup_embeds":true,"multilingual":true,"scheduling":true,"slack":true,"payments":true,"api_access":true,"remove_branding":true,"custom_fonts":true,"custom_seo":true,"email_templates":true,"confirmation_emails":true,"tracking_pixels":true,"calendar_sync":true,"business_apps":true,"partial_responses":true,"advanced_analytics":true,"pdf_documents":true,"ai_form_tools":true,"folders":true,"advanced_pixels":true,"team_hosts":true,"crm":true,"ai_insights":true,"advanced_reports":true,"response_workflow":true,"submission_editing":true,"team_notifications":true,"block_library":true,"advanced_logic":true,"data_lookups":true,"dynamic_themes":true,"embed_controls":true,"ab_testing":true,"email_otp":true,"multiple_workspaces":true,"granular_permissions":true,"audit_log":true,"auto_deletion":true,"sso":true,"scim":true}'::jsonb, null, null, false, null)
on conflict (id) do update set
  name = excluded.name,
  sort_order = excluded.sort_order,
  entitlements = excluded.entitlements,
  monthly_usd = excluded.monthly_usd,
  annual_usd = excluded.annual_usd,
  is_public = excluded.is_public,
  tagline = excluded.tagline;

/** The listed plans for the pricing page (no sign-in needed). */
create function public.public_plans()
returns table (
  id text, name text, sort_order integer, monthly_usd numeric, annual_usd numeric,
  tagline text, entitlements jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.sort_order, p.monthly_usd, p.annual_usd, p.tagline, p.entitlements
    from public.plans p
   where p.is_public
   order by p.sort_order;
$$;
revoke all on function public.public_plans() from public;
grant execute on function public.public_plans() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. AI credits priced by model: 1 for Haiku, 5 for Sonnet, 10 for Opus
--    (about $0.005 of model cost per credit, whichever model runs)
-- ---------------------------------------------------------------------------

alter table private.ai_prices
  add column credits_per_call integer not null default 5 check (credits_per_call between 1 and 100);
update private.ai_prices set credits_per_call = case
  when model like 'claude-haiku-%' then 1
  when model like 'claude-sonnet-%' then 5
  else 10 end;

-- Light work on Haiku (tagging, sentiment, follow-up questions); the rest
-- on Sonnet. Staff can change either through an approved request.
update private.ai_settings set model = 'claude-sonnet-5-5', updated_at = now() where feature = '*';
update private.ai_settings set model = 'claude-haiku-5-5', updated_at = now()
 where feature in ('response_analysis', 'follow_up');

/** May this call run, and with which model? Takes the model's credits
 * (1 Haiku, 5 Sonnet, 10 Opus) when it may. Codes: off, feature_off,
 * unknown_feature, ceiling, credits. */
create or replace function public.ai_begin(
  p_workspace_id uuid,
  p_feature text,
  p_credit_limit bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_global private.ai_settings;
  v_feature private.ai_settings;
  v_model text;
  v_cost integer;
  v_spent_micros bigint;
  v_credits bigint;
begin
  select * into v_global from private.ai_settings where feature = '*';
  if not found or not v_global.enabled then
    return jsonb_build_object('ok', false, 'code', 'off');
  end if;
  select * into v_feature from private.ai_settings where feature = p_feature and feature <> '*';
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_feature');
  end if;
  if not v_feature.enabled then
    return jsonb_build_object('ok', false, 'code', 'feature_off');
  end if;

  select cost_micros into v_spent_micros
    from private.ai_daily_cost where day = (now() at time zone 'UTC')::date;
  if v_spent_micros >= v_global.daily_ceiling_usd * 1000000 then
    perform private.raise_alert(
      'ai_ceiling_reached', 'critical',
      format('AI spend today ($%s) reached the daily ceiling of $%s. AI is paused for '
             'every customer until midnight UTC, or until the ceiling is raised.',
             round(v_spent_micros / 1000000.0, 2), v_global.daily_ceiling_usd),
      jsonb_build_object('spent_micros', v_spent_micros,
                         'ceiling_usd', v_global.daily_ceiling_usd));
    return jsonb_build_object('ok', false, 'code', 'ceiling');
  end if;
  if exists (select 1 from private.ops_alerts
              where kind = 'ai_ceiling_reached' and resolved_at is null) then
    perform private.resolve_alert('ai_ceiling_reached');
  end if;

  v_model := coalesce(v_feature.model, v_global.model);
  v_cost := coalesce((private.ai_price(v_model, now())).credits_per_call, 5);
  v_credits := public.spend_usage(p_workspace_id, 'ai_credits', p_credit_limit, v_cost);
  if v_credits is null then
    return jsonb_build_object('ok', false, 'code', 'credits');
  end if;
  return jsonb_build_object(
    'ok', true,
    'model', v_model,
    'max_tokens', v_feature.max_tokens,
    'credits_used', v_credits,
    'credits_cost', v_cost);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Storage, measured in the database (checked at every upload)
-- ---------------------------------------------------------------------------

create function public.workspace_storage_bytes(p_workspace_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
  select coalesce(sum(u.size_bytes), 0)::bigint
    from public.uploads u
    join public.responses r on r.id = u.response_id
    join public.forms f on f.id = r.form_id
   where f.workspace_id = p_workspace_id
     and u.status <> 'deleted';
$$;
revoke all on function public.workspace_storage_bytes(uuid) from public, anon, authenticated;
grant execute on function public.workspace_storage_bytes(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Upgrade requests (until checkout exists, staff change the plan)
-- ---------------------------------------------------------------------------

create table private.upgrade_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  plan_id text not null references public.plans (id),
  requested_by uuid not null references auth.users (id) on delete cascade,
  note text check (char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  handled_at timestamptz
);
create index upgrade_requests_open_idx on private.upgrade_requests (created_at)
  where handled_at is null;
alter table private.upgrade_requests enable row level security;

/** A workspace owner or admin asks for a plan; FormCraft staff are told
 * (an alert) and change the plan through an approved request. */
create function public.request_plan_upgrade(
  p_workspace_id uuid,
  p_plan_id text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_ws record;
begin
  if v_uid is null or not exists (
       select 1 from public.workspace_members
        where workspace_id = p_workspace_id and user_id = v_uid and role in ('owner', 'admin')) then
    return jsonb_build_object('ok', false, 'code', 'denied');
  end if;
  if not exists (select 1 from public.plans where id = p_plan_id and is_public) then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if exists (select 1 from private.upgrade_requests
              where workspace_id = p_workspace_id and handled_at is null
                and created_at > now() - interval '1 day') then
    return jsonb_build_object('ok', false, 'code', 'already_requested');
  end if;
  select id, name, plan_id into v_ws from public.workspaces where id = p_workspace_id;
  insert into private.upgrade_requests (workspace_id, plan_id, requested_by, note)
  values (p_workspace_id, p_plan_id, v_uid, nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;
  perform private.raise_alert(
    'upgrade_requested:' || v_id, 'info',
    format('%s asked to move from %s to %s. Change it on Customers.',
           v_ws.name, v_ws.plan_id, p_plan_id),
    jsonb_build_object('workspace_id', p_workspace_id, 'plan_id', p_plan_id));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.request_plan_upgrade(uuid, text, text) from public, anon;
grant execute on function public.request_plan_upgrade(uuid, text, text) to authenticated;

/** Open upgrade requests for the admin portal. */
create function public.admin_list_upgrade_requests()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_staff uuid := private.check_staff('customers.read');
begin
  if v_staff is null then return private.denial(); end if;
  return jsonb_build_object('ok', true, 'requests', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'workspace_id', r.workspace_id, 'workspace', w.name,
      'current_plan', w.plan_id, 'plan_id', r.plan_id, 'note', r.note,
      'created_at', r.created_at) order by r.created_at)
      from private.upgrade_requests r
      join public.workspaces w on w.id = r.workspace_id
     where r.handled_at is null), '[]'::jsonb));
end;
$$;
revoke all on function public.admin_list_upgrade_requests() from public, anon;
grant execute on function public.admin_list_upgrade_requests() to authenticated;

-- A plan change by staff settles the workspace's open requests.
create function private.settle_upgrade_requests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.plan_id is distinct from old.plan_id then
    update private.upgrade_requests set handled_at = now()
     where workspace_id = new.id and handled_at is null;
  end if;
  return new;
end;
$$;
create trigger workspaces_settle_upgrade_requests
  after update of plan_id on public.workspaces
  for each row execute function private.settle_upgrade_requests();

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
          or kind like 'staff_new_ip:%' or kind like 'upgrade_requested:%');
$$;

-- ---------------------------------------------------------------------------
-- 7. Notifications held back by the email quota
-- ---------------------------------------------------------------------------

/** Once a workspace's emails for the month are used, owner notifications
 * stop and are counted here; one summary a day goes to the owner instead
 * (bounded at one email a day, so it isn't held back itself). */
create table private.deferred_notifications (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  day date not null,
  form_id uuid not null references public.forms (id) on delete cascade,
  responses integer not null default 0,
  claimed_at timestamptz,
  primary key (workspace_id, day, form_id)
);
alter table private.deferred_notifications enable row level security;

create function public.ops_defer_notification(p_workspace_id uuid, p_form_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.deferred_notifications as d (workspace_id, day, form_id, responses)
  values (p_workspace_id, (now() at time zone 'UTC')::date, p_form_id, 1)
  on conflict (workspace_id, day, form_id) do update set responses = d.responses + 1;
$$;

/** Yesterday's (and older) held-back notifications, claimed once. */
create function public.ops_claim_deferred_notifications()
returns table (workspace_id uuid, day date, form_id uuid, responses integer)
language sql
security definer
set search_path = ''
as $$
  update private.deferred_notifications d set claimed_at = now()
   where d.claimed_at is null and d.day < (now() at time zone 'UTC')::date
  returning d.workspace_id, d.day, d.form_id, d.responses;
$$;

revoke all on function public.ops_defer_notification(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ops_defer_notification(uuid, uuid) to service_role;
revoke all on function public.ops_claim_deferred_notifications() from public, anon, authenticated;
grant execute on function public.ops_claim_deferred_notifications() to service_role;
