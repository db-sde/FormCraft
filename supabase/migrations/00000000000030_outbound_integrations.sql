-- Outbound integrations (Phase 2, Wave 4): Slack and Zapier/Make ride on
-- the existing webhook queue (claims, leases, backoff, idempotency);
-- confirmation emails and tracking pixels are per-form settings; API
-- keys authenticate Zapier/Make (and, later, the public API).

-- ---------------------------------------------------------------------
-- webhook endpoints gain a kind
-- ---------------------------------------------------------------------
alter table public.webhook_endpoints
  -- webhook: signed JSON to any https URL (as before)
  -- slack:   a Slack incoming-webhook URL; the message is formatted here
  -- zapier / make: REST-hook subscriptions made through the API
  add column kind text not null default 'webhook'
    check (kind in ('webhook', 'slack', 'zapier', 'make')),
  -- Per-kind settings, e.g. { "questionIds": [...] } for Slack.
  add column config jsonb not null default '{}' check (jsonb_typeof(config) = 'object'),
  -- The API key that created a Zapier/Make subscription (revoking the
  -- key removes its subscriptions).
  add column api_key_id uuid;

-- Slack URLs are only ever Slack's.
alter table public.webhook_endpoints
  add constraint webhook_endpoints_slack_url
  check (kind <> 'slack' or url like 'https://hooks.slack.com/%');

-- ---------------------------------------------------------------------
-- confirmation emails (P2.18)
-- ---------------------------------------------------------------------
create table public.confirmation_emails (
  form_id uuid primary key references public.forms (id) on delete cascade,
  enabled boolean not null default false,
  -- The email question (or contact block) whose answer receives it.
  recipient_question_id text check (recipient_question_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  subject text not null default 'Thanks for your response'
    check (length(subject) between 1 and 150),
  -- Plain text with {{recall}} tokens; escaped into the email layout.
  body text not null default 'We''ve got your answers. Thank you!'
    check (length(body) between 1 and 4000),
  cta_label text check (length(cta_label) <= 60),
  cta_url text check (cta_url ~ '^https://' and length(cta_url) <= 2000),
  updated_at timestamptz not null default now()
);

alter table public.confirmation_emails enable row level security;
create policy "confirmation_emails: members read via form" on public.confirmation_emails
  for select using (exists (
    select 1 from public.forms f
    where f.id = form_id and public.is_workspace_member(f.workspace_id)
  ));
create policy "confirmation_emails: editors manage via form" on public.confirmation_emails
  for all using (exists (
    select 1 from public.forms f
    where f.id = form_id and public.can_edit_workspace(f.workspace_id)
  )) with check (exists (
    select 1 from public.forms f
    where f.id = form_id and public.can_edit_workspace(f.workspace_id)
  ));
grant select, insert, update, delete on public.confirmation_emails to authenticated;

-- One confirmation per response, whatever retries: the send is claimed
-- by inserting here first.
create table public.confirmation_email_log (
  response_id uuid primary key references public.responses (id) on delete cascade,
  form_id uuid not null references public.forms (id) on delete cascade,
  status text not null check (status in ('sending', 'sent', 'failed', 'skipped')),
  error text,
  created_at timestamptz not null default now()
);
create index confirmation_email_log_form_day_idx
  on public.confirmation_email_log (form_id, created_at);
-- Server only.
alter table public.confirmation_email_log enable row level security;

-- ---------------------------------------------------------------------
-- tracking (P2.12): identifiers only, never code
-- ---------------------------------------------------------------------
alter table public.forms
  add column ga_measurement_id text check (ga_measurement_id ~ '^G-[A-Z0-9]{4,12}$'),
  add column gtm_container_id text check (gtm_container_id ~ '^GTM-[A-Z0-9]{4,10}$'),
  add column meta_pixel_id text check (meta_pixel_id ~ '^[0-9]{6,20}$');

-- ---------------------------------------------------------------------
-- API keys (Zapier / Make now, the public API later)
-- ---------------------------------------------------------------------
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  -- "fc_live_" + 6 characters, shown to recognise a key; the rest is
  -- only ever shown once, at creation.
  prefix text not null,
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index api_keys_workspace_id_idx on public.api_keys (workspace_id);

alter table public.api_keys enable row level security;
-- Admins see and revoke their workspace's keys; creating one goes
-- through the server (it's the only time the secret exists).
create policy "api_keys: admins can read" on public.api_keys
  for select using (public.can_admin_workspace(workspace_id));
create policy "api_keys: admins can revoke" on public.api_keys
  for update using (public.can_admin_workspace(workspace_id))
  with check (public.can_admin_workspace(workspace_id));
grant select, update on public.api_keys to authenticated;

alter table public.webhook_endpoints
  add constraint webhook_endpoints_api_key_fk
  foreign key (api_key_id) references public.api_keys (id) on delete cascade;

-- Revoking a key removes the subscriptions it made, so nothing keeps
-- receiving responses through a key that's been turned off.
create function public.drop_subscriptions_of_revoked_key()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.revoked_at is not null and old.revoked_at is null then
    delete from public.webhook_endpoints where api_key_id = new.id;
  end if;
  return new;
end;
$$;

create trigger api_keys_drop_subscriptions
  after update of revoked_at on public.api_keys
  for each row execute function public.drop_subscriptions_of_revoked_key();
