-- Integrations (webhooks, Google Sheets), analytics events, templates,
-- notification settings.

create table public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete cascade,
  url text not null,
  signing_secret text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index webhook_endpoints_form_id_idx on public.webhook_endpoints (form_id);

create type public.webhook_delivery_status as enum ('pending', 'succeeded', 'failed', 'exhausted');

create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references public.webhook_endpoints (id) on delete cascade,
  response_id uuid references public.responses (id) on delete set null,
  event_id uuid not null default gen_random_uuid(),
  event_type text not null,
  payload jsonb not null,
  status public.webhook_delivery_status not null default 'pending',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index webhook_deliveries_status_next_attempt_idx
  on public.webhook_deliveries (status, next_attempt_at);
create index webhook_deliveries_endpoint_id_idx on public.webhook_deliveries (endpoint_id);

create table public.sheets_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  form_id uuid not null references public.forms (id) on delete cascade,
  spreadsheet_id text,
  -- Tokens are encrypted at rest by the application layer (never stored
  -- as raw OAuth tokens); this column holds ciphertext + nonce as JSONB.
  encrypted_tokens jsonb not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (form_id)
);

create type public.sheets_sync_status as enum ('pending', 'succeeded', 'failed', 'exhausted');

create table public.sheets_sync_log (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.sheets_connections (id) on delete cascade,
  response_id uuid references public.responses (id) on delete set null,
  status public.sheets_sync_status not null default 'pending',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sheets_sync_log_status_next_attempt_idx
  on public.sheets_sync_log (status, next_attempt_at);

create table public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  form_id uuid references public.forms (id) on delete cascade,
  event_type text not null,
  is_preview boolean not null default false,
  session_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index analytics_events_form_event_created_idx
  on public.analytics_events (form_id, event_type, created_at);

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null,
  description text,
  schema jsonb not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notification_settings (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (form_id)
);

create trigger webhook_endpoints_set_updated_at
  before update on public.webhook_endpoints
  for each row execute function public.set_updated_at();
create trigger webhook_deliveries_set_updated_at
  before update on public.webhook_deliveries
  for each row execute function public.set_updated_at();
create trigger sheets_connections_set_updated_at
  before update on public.sheets_connections
  for each row execute function public.set_updated_at();
create trigger sheets_sync_log_set_updated_at
  before update on public.sheets_sync_log
  for each row execute function public.set_updated_at();
create trigger templates_set_updated_at
  before update on public.templates
  for each row execute function public.set_updated_at();
create trigger notification_settings_set_updated_at
  before update on public.notification_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.webhook_endpoints enable row level security;
alter table public.webhook_deliveries enable row level security;
alter table public.sheets_connections enable row level security;
alter table public.sheets_sync_log enable row level security;
alter table public.analytics_events enable row level security;
alter table public.templates enable row level security;
alter table public.notification_settings enable row level security;

create policy "webhook_endpoints: members manage via form" on public.webhook_endpoints
  for all using (
    exists (
      select 1 from public.forms f
      where f.id = form_id and public.is_workspace_member(f.workspace_id)
    )
  );

create policy "webhook_deliveries: members read via endpoint" on public.webhook_deliveries
  for select using (
    exists (
      select 1 from public.webhook_endpoints we
      join public.forms f on f.id = we.form_id
      where we.id = endpoint_id and public.is_workspace_member(f.workspace_id)
    )
  );

create policy "sheets_connections: members manage" on public.sheets_connections
  for all using (public.is_workspace_member(workspace_id));

create policy "sheets_sync_log: members read via connection" on public.sheets_sync_log
  for select using (
    exists (
      select 1 from public.sheets_connections sc
      where sc.id = connection_id and public.is_workspace_member(sc.workspace_id)
    )
  );

create policy "analytics_events: members read via form" on public.analytics_events
  for select using (
    form_id is null or exists (
      select 1 from public.forms f
      where f.id = form_id and public.is_workspace_member(f.workspace_id)
    )
  );

create policy "templates: anyone authenticated can read" on public.templates
  for select
  to authenticated
  using (true);

create policy "notification_settings: members manage via form" on public.notification_settings
  for all using (
    exists (
      select 1 from public.forms f
      where f.id = form_id and public.is_workspace_member(f.workspace_id)
    )
  );
