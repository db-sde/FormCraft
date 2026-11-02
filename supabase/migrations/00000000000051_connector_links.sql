-- Master spec Phase 6 (2026-11-02): business integrations — Airtable
-- (F-33), Salesforce (F-34), Notion (F-36), Mailchimp (F-38), Zoho CRM and
-- Pipedrive (F-40) — on the connector framework from migration 50.

-- A form's link to a connected app: where its responses go, how answers
-- map onto the destination's fields, and when (an optional condition).
create table public.connector_links (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete cascade,
  provider text not null check (provider in ('airtable', 'salesforce', 'notion', 'mailchimp', 'zoho_crm', 'pipedrive')),
  enabled boolean not null default true,
  -- The destination and options: a base and table, a database, an
  -- audience, an object, how to find duplicates…
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  -- [{ field, source }] — source is "answer:<id>[.<part>]", "meta:<name>",
  -- "hidden:<name>" or "text:<value>".
  mapping jsonb not null default '[]'::jsonb check (jsonb_typeof(mapping) = 'array'),
  condition jsonb check (condition is null or jsonb_typeof(condition) = 'object'),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (form_id, provider)
);

alter table public.connector_links enable row level security;
create policy "mfa: second factor when enrolled" on public.connector_links as restrictive
  for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
create policy "connector_links: members read" on public.connector_links
  for select using (exists (
    select 1 from public.forms f where f.id = form_id and public.is_workspace_member(f.workspace_id)
  ));
create policy "connector_links: integration managers write" on public.connector_links
  for all using (exists (
    select 1 from public.forms f where f.id = form_id
      and public.can_edit_workspace(f.workspace_id)
      and public.has_permission(f.workspace_id, 'manage_integrations')
  )) with check (exists (
    select 1 from public.forms f where f.id = form_id
      and public.can_edit_workspace(f.workspace_id)
      and public.has_permission(f.workspace_id, 'manage_integrations')
  ));
revoke all on public.connector_links from anon;
grant select, insert, update, delete on public.connector_links to authenticated;
grant select, insert, update, delete on public.connector_links to service_role;

-- Completed responses a link should have synced but has no job for (the
-- post-response callback failed or was killed). The cron sweep queues
-- them. Spam-flagged responses and confidential forms are left out, as
-- they are when submitting.
create function public.responses_missing_connector_sync(p_limit integer)
returns table (response_id uuid)
language sql
stable
as $$
  select distinct r.id
  from public.connector_links l
  join public.forms f on f.id = l.form_id and f.confidential is null
  join public.responses r on r.form_id = l.form_id
  where l.enabled
    and r.status = 'completed'
    and not r.spam_suspected
    and r.completed_at > now() - interval '24 hours'
    and r.completed_at < now() - interval '2 minutes'
    and r.completed_at >= l.created_at
    and not exists (
      select 1 from public.connector_jobs j
      where j.idempotency_key = l.provider || ':' || l.id || ':' || r.id
    )
  limit p_limit;
$$;

revoke all on function public.responses_missing_connector_sync(integer) from public, anon, authenticated;
grant execute on function public.responses_missing_connector_sync(integer) to service_role;
