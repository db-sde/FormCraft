-- Master spec Phase 5 (2026-11-02): native bookings (F-27) with Google
-- Calendar sync (F-43), on the shared connector framework (spec §5.3)
-- that Phase 6's connectors also use.

create extension if not exists btree_gist with schema extensions;

-- 1. Booking types: what can be booked, by whom, when.
create table public.booking_types (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  duration_minutes integer not null check (duration_minutes between 5 and 480),
  -- How often a slot starts; the duration when null.
  interval_minutes integer check (interval_minutes between 5 and 480),
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes between 0 and 240),
  buffer_after_minutes integer not null default 0 check (buffer_after_minutes between 0 and 240),
  min_notice_minutes integer not null default 120 check (min_notice_minutes between 0 and 20160),
  max_days_ahead integer not null default 30 check (max_days_ahead between 1 and 365),
  time_zone text not null check (char_length(time_zone) between 1 and 64),
  -- [{ day: 0-6 (Sunday first), start: "HH:mm", end: "HH:mm" }]
  weekly jsonb not null default '[]'::jsonb check (jsonb_typeof(weekly) = 'array'),
  blocked_dates date[] not null default '{}' check (cardinality(blocked_dates) <= 366),
  location text check (location is null or char_length(location) <= 500),
  reminders boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index booking_types_workspace_idx on public.booking_types (workspace_id);

create table public.booking_hosts (
  booking_type_id uuid not null references public.booking_types (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (booking_type_id, user_id)
);

-- 2. Bookings. `blocked` is the host's busy time including buffers; no
-- host can hold two live bookings whose blocked times overlap — the
-- database refuses it, whatever races in the app.
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  booking_type_id uuid not null references public.booking_types (id) on delete cascade,
  host_id uuid not null references public.profiles (id) on delete cascade,
  form_id uuid references public.forms (id) on delete set null,
  response_id uuid references public.responses (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  blocked tstzrange not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled')),
  attendee_name text check (attendee_name is null or char_length(attendee_name) <= 200),
  attendee_email text check (attendee_email is null or char_length(attendee_email) <= 254),
  attendee_time_zone text check (attendee_time_zone is null or char_length(attendee_time_zone) <= 64),
  -- sha256 of the attendee's manage link token; the token itself is
  -- only ever in their email.
  manage_token_hash text not null unique,
  cancelled_at timestamptz,
  cancelled_by text check (cancelled_by is null or cancelled_by in ('attendee', 'host', 'calendar', 'system')),
  rescheduled_from uuid references public.bookings (id) on delete set null,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint bookings_no_overlap exclude using gist (
    host_id with =, blocked with &&
  ) where (status in ('pending', 'confirmed'))
);
create index bookings_type_start_idx on public.bookings (booking_type_id, starts_at);
create index bookings_response_idx on public.bookings (response_id);
create index bookings_reminder_idx on public.bookings (starts_at)
  where status = 'confirmed' and reminder_sent_at is null;

-- Takes a slot for the first free host, atomically. Pending bookings that
-- were never confirmed (a submit that didn't finish) stop holding their
-- slot after 15 minutes. Returns the booking, or nothing when every host
-- is taken. Service role only.
create function public.book_slot(
  p_booking_type_id uuid,
  p_host_ids uuid[],
  p_starts_at timestamptz,
  p_form_id uuid,
  p_response_id uuid,
  p_attendee_name text,
  p_attendee_email text,
  p_attendee_time_zone text,
  p_manage_token_hash text,
  p_rescheduled_from uuid default null
)
returns table (id uuid, host_id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.booking_types;
  v_end timestamptz;
  v_host uuid;
begin
  select * into t from public.booking_types bt where bt.id = p_booking_type_id and bt.archived_at is null;
  if not found then
    raise exception 'booking type not found';
  end if;
  v_end := p_starts_at + make_interval(mins => t.duration_minutes);

  update public.bookings b set status = 'cancelled', cancelled_at = now(), cancelled_by = 'system'
    where b.status = 'pending' and b.created_at < now() - interval '15 minutes'
      and b.host_id = any (p_host_ids);

  foreach v_host in array p_host_ids loop
    begin
      return query
        insert into public.bookings as b (
          booking_type_id, host_id, form_id, response_id, starts_at, ends_at, blocked,
          attendee_name, attendee_email, attendee_time_zone, manage_token_hash, rescheduled_from
        ) values (
          p_booking_type_id, v_host, p_form_id, p_response_id, p_starts_at, v_end,
          tstzrange(
            p_starts_at - make_interval(mins => t.buffer_before_minutes),
            v_end + make_interval(mins => t.buffer_after_minutes),
            '[)'
          ),
          p_attendee_name, p_attendee_email, p_attendee_time_zone, p_manage_token_hash, p_rescheduled_from
        )
        returning b.id, b.host_id, b.starts_at, b.ends_at;
      return;
    exception when exclusion_violation then
      -- That host is taken; try the next.
      null;
    end;
  end loop;
end;
$$;
revoke all on function public.book_slot(uuid, uuid[], timestamptz, uuid, uuid, text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.book_slot(uuid, uuid[], timestamptz, uuid, uuid, text, text, text, text, uuid)
  to service_role;

-- 3. The shared connector framework (spec §5.3): connections (encrypted
-- credentials, per workspace, or per member for calendars), and jobs —
-- every outbound action with a durable idempotency key, retries with
-- backoff, a final error state, and its own attempt log.
create table public.connector_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- Set for personal connections (a host's own calendar).
  user_id uuid references public.profiles (id) on delete cascade,
  provider text not null check (provider ~ '^[a-z_]{2,40}$'),
  -- { iv, authTag, ciphertext } — never the raw tokens.
  encrypted jsonb not null,
  -- Safe to show: the account's email or name.
  label text check (label is null or char_length(label) <= 200),
  -- Non-secret choices: the calendar id, an Airtable base, a list…
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  status text not null default 'ok' check (status in ('ok', 'invalid', 'revoked')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index connector_connections_workspace_idx
  on public.connector_connections (workspace_id, provider) where user_id is null;
create unique index connector_connections_user_idx
  on public.connector_connections (workspace_id, provider, user_id) where user_id is not null;

create table public.connector_jobs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references public.connector_connections (id) on delete set null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null,
  action text not null check (char_length(action) <= 60),
  -- The same action for the same thing is queued once, whatever retries.
  idempotency_key text not null unique check (char_length(idempotency_key) <= 300),
  response_id uuid references public.responses (id) on delete cascade,
  booking_id uuid references public.bookings (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed', 'exhausted', 'skipped')),
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text check (last_error is null or char_length(last_error) <= 500),
  -- What the provider gave back that later actions need (an event id).
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index connector_jobs_due_idx on public.connector_jobs (status, next_attempt_at)
  where status in ('pending', 'failed');
create index connector_jobs_response_idx on public.connector_jobs (response_id);
create index connector_jobs_booking_idx on public.connector_jobs (booking_id);

-- Claims due jobs for a worker (skip locked, leased), like the webhook
-- and Sheets workers.
create function public.claim_connector_jobs(p_limit integer, p_lease_seconds integer)
returns setof public.connector_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    update public.connector_jobs j
      set status = 'running',
          attempt_count = j.attempt_count + 1,
          next_attempt_at = now() + make_interval(secs => p_lease_seconds),
          updated_at = now()
      where j.id in (
        select c.id from public.connector_jobs c
        where (c.status in ('pending', 'failed') and c.next_attempt_at <= now())
           or (c.status = 'running' and c.next_attempt_at <= now())
        order by c.next_attempt_at
        limit p_limit
        for update skip locked
      )
      returning j.*;
end;
$$;
revoke all on function public.claim_connector_jobs(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_connector_jobs(integer, integer) to service_role;

-- Row-level security. Booking types: members read, editors write. Bookings:
-- members who can see responses read; the server writes. Connections:
-- members see a safe summary through connector_status; jobs: read with
-- the right to see responses.
alter table public.booking_types enable row level security;
alter table public.booking_hosts enable row level security;
alter table public.bookings enable row level security;
alter table public.connector_connections enable row level security;
alter table public.connector_jobs enable row level security;

create policy "mfa: second factor when enrolled" on public.booking_types as restrictive
  for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
create policy "mfa: second factor when enrolled" on public.booking_hosts as restrictive
  for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
create policy "mfa: second factor when enrolled" on public.bookings as restrictive
  for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
create policy "mfa: second factor when enrolled" on public.connector_connections as restrictive
  for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
create policy "mfa: second factor when enrolled" on public.connector_jobs as restrictive
  for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

create policy "booking_types: members read" on public.booking_types
  for select using (public.is_workspace_member(workspace_id));
create policy "booking_types: editors write" on public.booking_types
  for all using (public.can_edit_workspace(workspace_id))
  with check (public.can_edit_workspace(workspace_id));
create policy "booking_hosts: members read" on public.booking_hosts
  for select using (exists (
    select 1 from public.booking_types t where t.id = booking_type_id and public.is_workspace_member(t.workspace_id)
  ));
create policy "booking_hosts: editors write" on public.booking_hosts
  for all using (exists (
    select 1 from public.booking_types t where t.id = booking_type_id and public.can_edit_workspace(t.workspace_id)
  )) with check (exists (
    select 1 from public.booking_types t where t.id = booking_type_id and public.can_edit_workspace(t.workspace_id)
  ));
create policy "bookings: permitted members read" on public.bookings
  for select using (exists (
    select 1 from public.booking_types t
    where t.id = booking_type_id and public.has_permission(t.workspace_id, 'view_responses')
  ));
create policy "connector_jobs: permitted members read" on public.connector_jobs
  for select using (public.has_permission(workspace_id, 'view_responses'));

-- A safe summary of connections (no secrets) for the workspace's members.
create function public.connector_status(p_workspace_id uuid)
returns table (id uuid, provider text, user_id uuid, label text, status text, settings jsonb, created_at timestamptz)
language sql
security definer
stable
set search_path = ''
as $$
  select c.id, c.provider, c.user_id, c.label, c.status, c.settings, c.created_at
  from public.connector_connections c
  where c.workspace_id = p_workspace_id and public.is_workspace_member(p_workspace_id);
$$;
revoke all on function public.connector_status(uuid) from public, anon;
grant execute on function public.connector_status(uuid) to authenticated, service_role;

revoke all on public.booking_types, public.booking_hosts, public.bookings,
  public.connector_connections, public.connector_jobs from anon;
grant select, insert, update, delete on public.booking_types, public.booking_hosts to authenticated;
grant select on public.bookings, public.connector_jobs to authenticated;
revoke all on public.connector_connections from authenticated;
grant select, insert, update, delete on public.booking_types, public.booking_hosts, public.bookings,
  public.connector_connections, public.connector_jobs to service_role;

-- 4. Timeline kinds for bookings and connectors.
alter table public.response_events drop constraint response_events_kind_check;
alter table public.response_events add constraint response_events_kind_check check (kind in (
  'email_owner', 'email_respondent', 'replay', 'status_changed', 'assigned', 'commented',
  'document_emailed', 'email_rule', 'booking'
));
