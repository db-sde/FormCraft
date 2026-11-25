-- Super Admin, Phase 4 (docs/super-admin-design.md §3.12, §3.13):
-- privacy requests handled across every workspace, a record of each
-- retention run, and service notices to customers.
--
-- Privacy requests (ADM-085/086) have a 30-day deadline and need the
-- person's identity checked before anything is exported or erased.
-- Erasure needs a second person's approval. It removes every response
-- carrying the address, in every workspace: files, webhook payloads,
-- remembered answers and booking details. What was removed is kept as
-- counts, never the data. Each workspace affected sees it in its own
-- audit log.
--
-- Retention (ADM-091): each daily run is recorded per job, and a failed
-- or missing run raises an alert.
--
-- Notices (ADM-098): service messages only (incidents, billing, policy)
-- to workspace owners. Each one needs approval, at most five are sent a
-- day, sending is capped per run, and every recipient is logged.

-- ---------------------------------------------------------------------------
-- 1. Approval rules
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
    ('plan.update', 'plans.change', 'approvals.decide', array['owner', 'admin']),
    ('ai.settings', 'ai.settings', 'approvals.decide', array['owner', 'admin']),
    ('privacy.erase', 'privacy.manage', 'approvals.decide', array['owner', 'admin', 'privacy']),
    ('message.send', 'comms.send', 'approvals.decide', array['owner', 'admin'])
  ) r(action, request_permission, approve_permission, approver_roles)
  where r.action = p_action;
$$;

-- ---------------------------------------------------------------------------
-- 2. Finding a person across workspaces
-- ---------------------------------------------------------------------------

/** The address an answer carries, when it carries one (an email answer,
 * a text answer that is an address, or a contact step's email). */
create function private.answer_email(p_value jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') like '%@%'
      then lower(btrim(p_value #>> '{}'))
    when jsonb_typeof(p_value) = 'object' and p_value ? 'email'
      then lower(btrim(p_value ->> 'email'))
  end;
$$;

create index if not exists answers_email_idx
  on public.answers (private.answer_email(value))
  where private.answer_email(value) is not null;

/** Every response, in any workspace, carrying this address. */
create function private.person_responses(p_email text)
returns table (response_id uuid, workspace_id uuid, form_id uuid, visitor_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct r.id, f.workspace_id, f.id, r.visitor_id
    from public.answers a
    join public.responses r on r.id = a.response_id
    join public.forms f on f.id = r.form_id
   where length(btrim(p_email)) >= 3
     and private.answer_email(a.value) = lower(btrim(p_email))
     and private.answer_email(a.value) is not null;
$$;

-- ---------------------------------------------------------------------------
-- 3. Privacy requests
-- ---------------------------------------------------------------------------

create table private.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('access', 'erasure', 'rectification')),
  requester_email text not null check (requester_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
                                        and char_length(requester_email) <= 254),
  received_at timestamptz not null default now(),
  due_at timestamptz not null,
  note text check (char_length(note) <= 2000),
  identity_verified_at timestamptz,
  identity_note text check (char_length(identity_note) <= 500),
  scope jsonb,
  scoped_at timestamptz,
  status text not null default 'open' check (status in ('open', 'completed', 'rejected')),
  outcome_note text check (char_length(outcome_note) <= 2000),
  evidence jsonb,
  created_by uuid not null references private.staff_members (user_id),
  handled_by uuid references private.staff_members (user_id),
  completed_at timestamptz
);
create index privacy_requests_open_idx on private.privacy_requests (due_at) where status = 'open';
alter table private.privacy_requests enable row level security;

/** Logs a request as it arrived (email, a form, a letter). */
create function public.admin_privacy_open(
  p_type text,
  p_email text,
  p_received_at timestamptz,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_staff uuid := private.check_staff('privacy.manage');
  v_received timestamptz := least(coalesce(p_received_at, now()), now());
  v_id uuid;
begin
  if v_staff is null then return private.denial(); end if;
  if p_type not in ('access', 'erasure', 'rectification')
     or lower(btrim(coalesce(p_email, ''))) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     or v_received < now() - interval '1 year' then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  insert into private.privacy_requests (
    type, requester_email, received_at, due_at, note, created_by
  ) values (
    p_type, lower(btrim(p_email)), v_received, v_received + interval '30 days',
    nullif(btrim(coalesce(p_note, '')), ''), v_staff
  ) returning id into v_id;
  perform private.log_admin_action(
    v_staff, 'privacy.opened', 'succeeded', null, 'privacy_request', v_id::text, null, null,
    jsonb_build_object('type', p_type));
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

/** Open requests by deadline, recent closed ones, and retention health. */
create function public.admin_privacy_overview()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_staff uuid := private.check_staff('privacy.manage');
begin
  if v_staff is null then return private.denial(); end if;
  return jsonb_build_object(
    'ok', true,
    'now', now(),
    'open', (
      select coalesce(jsonb_agg(to_jsonb(q) order by q.due_at), '[]'::jsonb)
        from (select id, type, requester_email, received_at, due_at,
                     identity_verified_at is not null as verified, scoped_at,
                     (scope ->> 'responses')::int as responses
                from private.privacy_requests where status = 'open') q),
    'closed', (
      select coalesce(jsonb_agg(to_jsonb(q) order by q.completed_at desc), '[]'::jsonb)
        from (select id, type, requester_email, status, completed_at, due_at
                from private.privacy_requests where status <> 'open'
               order by completed_at desc limit 25) q),
    'retention', (
      select coalesce(jsonb_agg(to_jsonb(r) order by r.ran_at desc), '[]'::jsonb)
        from (select job, ran_at, ok, counts, error, duration_ms
                from private.retention_runs where job <> 'setup'
               order by ran_at desc limit 40) r),
    'files_waiting', (select count(*) from private.storage_deletions where done_at is null)
  );
end;
$$;

/** One request with what was found and done. Opening it is logged. */
create function public.admin_privacy_get(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_staff uuid := private.check_staff('privacy.manage');
  v_req private.privacy_requests;
begin
  if v_staff is null then return private.denial(); end if;
  select * into v_req from private.privacy_requests where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  perform private.log_admin_action(
    v_staff, 'privacy.viewed', 'succeeded', null, 'privacy_request', p_id::text);
  return jsonb_build_object('ok', true, 'request', to_jsonb(v_req) || jsonb_build_object(
    'created_by_name', (select display_name from private.staff_members where user_id = v_req.created_by),
    'handled_by_name', (select display_name from private.staff_members where user_id = v_req.handled_by),
    'erasure_pending', exists (
      select 1 from private.change_requests c
       where c.action = 'privacy.erase' and c.target_id = p_id::text
         and c.status in ('pending', 'approved') and c.expires_at > now())));
end;
$$;

/** Records how the person's identity was checked (for example: they
 * replied from that address). Export and erasure need it first. */
create function public.admin_privacy_verify(p_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_staff uuid := private.check_staff('privacy.manage');
begin
  if v_staff is null then return private.denial(); end if;
  if char_length(btrim(coalesce(p_note, ''))) not between 5 and 500 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  update private.privacy_requests
     set identity_verified_at = now(), identity_note = btrim(p_note), handled_by = v_staff
   where id = p_id and status = 'open';
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  perform private.log_admin_action(
    v_staff, 'privacy.verified', 'succeeded', btrim(p_note), 'privacy_request', p_id::text);
  return jsonb_build_object('ok', true);
end;
$$;

/** Where the person's data is: responses and bookings per workspace, and
 * whether they also have a FormCraft account (handled through account
 * deletion, not here). Stored on the request. */
create function public.admin_privacy_find(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare
  v_staff uuid := private.check_staff('privacy.manage');
  v_req private.privacy_requests;
  v_scope jsonb;
begin
  if v_staff is null then return private.denial(); end if;
  select * into v_req from private.privacy_requests where id = p_id;
  if not found or v_req.status <> 'open' then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  with found as (select * from private.person_responses(v_req.requester_email)),
  booked as (
    select f.workspace_id, count(*) as n
      from public.bookings b join public.forms f on f.id = b.form_id
     where lower(b.attendee_email) = v_req.requester_email
     group by f.workspace_id),
  per_ws as (
    select w.id, w.name, w.slug,
           (select count(*) from found x where x.workspace_id = w.id) as responses,
           coalesce((select n from booked b where b.workspace_id = w.id), 0) as bookings
      from public.workspaces w
     where w.id in (select workspace_id from found union select workspace_id from booked))
  select jsonb_build_object(
    'responses', (select count(*) from found),
    'bookings', coalesce((select sum(n) from booked), 0),
    'workspaces', coalesce((select jsonb_agg(to_jsonb(p) order by p.responses desc) from per_ws p),
                           '[]'::jsonb),
    'account_exists', exists (select 1 from auth.users u
                               where lower(u.email) = v_req.requester_email))
    into v_scope;
  update private.privacy_requests
     set scope = v_scope, scoped_at = now(), handled_by = v_staff
   where id = p_id;
  perform private.log_admin_action(
    v_staff, 'privacy.searched', 'succeeded', null, 'privacy_request', p_id::text, null, null,
    jsonb_build_object('responses', v_scope -> 'responses', 'bookings', v_scope -> 'bookings'));
  return jsonb_build_object('ok', true, 'scope', v_scope);
end;
$$;

/** Everything held about the person, as JSON to give them (an access
 * request). Needs a verified identity and a fresh second factor. */
create function public.admin_privacy_export(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '60s'
as $$
declare
  v_staff uuid := private.check_staff('privacy.manage', true);
  v_req private.privacy_requests;
  v_export jsonb;
begin
  if v_staff is null then return private.denial(); end if;
  select * into v_req from private.privacy_requests where id = p_id;
  if not found or v_req.status <> 'open' then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_req.identity_verified_at is null then
    return jsonb_build_object('ok', false, 'code', 'not_verified');
  end if;
  select jsonb_build_object(
    'email', v_req.requester_email,
    'exported_at', now(),
    'responses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'organisation', w.name,
        'form', f.title,
        'status', r.status,
        'started_at', r.started_at,
        'completed_at', r.completed_at,
        'language', r.language,
        'referrer', r.referrer,
        'answers', coalesce((
          select jsonb_agg(jsonb_build_object(
            'question', coalesce((
              select q ->> 'label' from jsonb_array_elements(fv.schema -> 'questions') q
               where q ->> 'id' = a.question_id limit 1), a.question_id),
            'answer', a.value) order by a.question_id)
            from public.answers a where a.response_id = r.id), '[]'::jsonb),
        'follow_ups', coalesce((
          select jsonb_agg(jsonb_build_object('question', fu.prompt, 'answer', fu.answer))
            from public.response_followups fu where fu.response_id = r.id), '[]'::jsonb),
        'files', coalesce((
          select jsonb_agg(u.original_filename) from public.uploads u where u.response_id = r.id),
          '[]'::jsonb),
        'payments', coalesce((
          select jsonb_agg(jsonb_build_object('amount', p.amount, 'currency', p.currency,
                                              'status', p.status))
            from public.payments p where p.response_id = r.id), '[]'::jsonb)
      ) order by r.started_at)
        from (select distinct response_id from private.person_responses(v_req.requester_email)) x
        join public.responses r on r.id = x.response_id
        join public.forms f on f.id = r.form_id
        join public.workspaces w on w.id = f.workspace_id
        join public.form_versions fv on fv.id = r.form_version_id), '[]'::jsonb),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'organisation', w.name, 'starts_at', b.starts_at, 'ends_at', b.ends_at,
        'status', b.status, 'name', b.attendee_name, 'time_zone', b.attendee_time_zone)
        order by b.starts_at)
        from public.bookings b
        join public.forms f on f.id = b.form_id
        join public.workspaces w on w.id = f.workspace_id
       where lower(b.attendee_email) = v_req.requester_email), '[]'::jsonb)
  ) into v_export;
  update private.privacy_requests set handled_by = v_staff where id = p_id;
  perform private.log_admin_action(
    v_staff, 'privacy.exported', 'succeeded', null, 'privacy_request', p_id::text, null, null,
    jsonb_build_object('responses', jsonb_array_length(v_export -> 'responses'),
                       'bookings', jsonb_array_length(v_export -> 'bookings')));
  return jsonb_build_object('ok', true, 'export', v_export);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Erasure, and the files it leaves to remove
-- ---------------------------------------------------------------------------

/** Stored files to remove through the storage API (the database can't
 * delete them itself). The ops job works through it. */
create table private.storage_deletions (
  id bigint generated always as identity primary key,
  bucket text not null,
  path text not null,
  reason text not null,
  queued_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  done_at timestamptz
);
create index storage_deletions_waiting_idx on private.storage_deletions (id) where done_at is null;
alter table private.storage_deletions enable row level security;

/** Erases the person's data everywhere, with an approved request for
 * exactly this privacy request and address. */
create function public.admin_apply_privacy_erasure(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '120s'
as $$
declare
  v_staff uuid;
  v_change private.change_requests;
  v_req private.privacy_requests;
  v_ids uuid[];
  v_files integer;
  v_hooks integer;
  v_profiles integer;
  v_bookings integer;
  v_per_ws jsonb;
  v_evidence jsonb;
  v_ws record;
begin
  v_staff := private.check_staff('privacy.manage', true);
  if v_staff is null then return private.denial(); end if;
  select * into v_change from private.change_requests where id = p_request_id;
  if not found or v_change.action <> 'privacy.erase' then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into v_req from private.privacy_requests where id = v_change.target_id::uuid for update;
  if not found or v_req.status <> 'open' or v_req.type <> 'erasure'
     or v_change.payload ->> 'email' is distinct from v_req.requester_email then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'why', 'request does not match');
  end if;
  if v_req.identity_verified_at is null then
    return jsonb_build_object('ok', false, 'code', 'not_verified');
  end if;
  if private.consume_approval(p_request_id, v_change.action, v_change.target_id, v_change.payload)
     is null then
    perform private.log_admin_action(
      v_staff, 'privacy.erase', 'denied', 'no approved request', 'privacy_request',
      v_req.id::text, null, p_request_id, '{}'::jsonb);
    return jsonb_build_object('ok', false, 'code', 'approval_required');
  end if;

  create temporary table erase_set on commit drop as
    select * from private.person_responses(v_req.requester_email);
  select coalesce(array_agg(distinct response_id), '{}') into v_ids from erase_set;
  select coalesce(jsonb_object_agg(workspace_id, n), '{}'::jsonb) into v_per_ws
    from (select workspace_id, count(distinct response_id) as n from erase_set
           group by workspace_id) s;

  insert into private.storage_deletions (bucket, path, reason)
  select 'response-uploads', u.storage_path, 'privacy:' || v_req.id
    from public.uploads u where u.response_id = any (v_ids);
  get diagnostics v_files = row_count;

  -- Webhook payloads carry the answers and outlive the response.
  delete from public.webhook_deliveries where response_id = any (v_ids);
  get diagnostics v_hooks = row_count;

  -- Answers remembered for the person's browser ("ask once").
  delete from public.visitor_profiles v
   using (select distinct workspace_id, visitor_id from erase_set where visitor_id is not null) e
   where v.workspace_id = e.workspace_id and v.visitor_id = e.visitor_id;
  get diagnostics v_profiles = row_count;

  -- Bookings keep the slot (calendars depend on it), not the person.
  update public.bookings
     set attendee_name = null, attendee_email = null, attendee_time_zone = null
   where lower(attendee_email) = v_req.requester_email or response_id = any (v_ids);
  get diagnostics v_bookings = row_count;

  -- Answers, follow-ups, uploads' rows, payments and the rest go with
  -- the response (foreign keys cascade).
  delete from public.responses where id = any (v_ids);

  -- Each workspace sees it in its own audit log.
  for v_ws in select key::uuid as id, value::int as n from jsonb_each_text(v_per_ws) loop
    insert into public.audit_logs (workspace_id, actor_id, action, target_type, target_id,
                                   metadata, reason, outcome)
    values (v_ws.id, null, 'support.privacy_erased', 'privacy_request', v_req.id::text,
            jsonb_build_object('by', 'FormCraft support', 'responses', v_ws.n),
            'A person asked FormCraft to erase their data', 'succeeded');
  end loop;

  v_evidence := jsonb_build_object(
    'erased_at', now(),
    'responses', cardinality(v_ids),
    'workspaces', v_per_ws,
    'files_queued', v_files,
    'webhook_payloads', v_hooks,
    'remembered_answers', v_profiles,
    'bookings_anonymised', v_bookings,
    'approval_id', p_request_id,
    'backups', 'Copies in database backups remain until the backups expire.');
  update private.privacy_requests
     set status = 'completed', completed_at = now(), handled_by = v_staff, evidence = v_evidence
   where id = v_req.id;
  perform private.log_admin_action(
    v_staff, 'privacy.erase', 'succeeded', v_change.reason, 'privacy_request', v_req.id::text,
    null, p_request_id, v_evidence - 'backups');
  return jsonb_build_object('ok', true, 'evidence', v_evidence);
end;
$$;

/** Closes a request (sent the export, corrected a record, or refused with
 * the reason recorded). Erasure closes itself when it's carried out. */
create function public.admin_privacy_close(p_id uuid, p_status text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_staff uuid := private.check_staff('privacy.manage', true);
begin
  if v_staff is null then return private.denial(); end if;
  if p_status not in ('completed', 'rejected') then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if char_length(btrim(coalesce(p_note, ''))) not between 5 and 2000 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  update private.privacy_requests
     set status = p_status, outcome_note = btrim(p_note), completed_at = now(),
         handled_by = v_staff
   where id = p_id and status = 'open'
     and (p_status = 'rejected' or type <> 'erasure');
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  perform private.log_admin_action(
    v_staff, 'privacy.' || p_status, 'succeeded', btrim(p_note), 'privacy_request', p_id::text);
  return jsonb_build_object('ok', true);
end;
$$;

-- Files: the ops job claims a batch, removes them, reports back.
create function public.ops_storage_deletions_claim(p_limit integer default 200)
returns table (id bigint, bucket text, path text)
language sql
security definer
set search_path = ''
as $$
  update private.storage_deletions d set attempts = d.attempts + 1
   where d.id in (select s.id from private.storage_deletions s
                   where s.done_at is null and s.attempts < 10
                   order by s.id limit least(greatest(p_limit, 1), 500)
                   for update skip locked)
  returning d.id, d.bucket, d.path;
$$;

create function public.ops_storage_deletions_done(p_ids bigint[], p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.storage_deletions
     set done_at = case when p_error is null then now() end,
         last_error = left(p_error, 500)
   where id = any (p_ids);
$$;

-- ---------------------------------------------------------------------------
-- 5. Retention runs
-- ---------------------------------------------------------------------------

create table private.retention_runs (
  id bigint generated always as identity primary key,
  job text not null check (job ~ '^[a-z_]{2,40}$'),
  ran_at timestamptz not null default now(),
  ok boolean not null,
  counts jsonb not null default '{}'::jsonb,
  error text check (char_length(error) <= 500),
  duration_ms integer
);
create index retention_runs_job_idx on private.retention_runs (job, ran_at desc);
alter table private.retention_runs enable row level security;
-- The clock for "no run for over a day" starts now.
insert into private.retention_runs (job, ok) values ('setup', true);

create function public.ops_record_retention_run(
  p_job text,
  p_ok boolean,
  p_counts jsonb,
  p_error text default null,
  p_duration_ms integer default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.retention_runs (job, ok, counts, error, duration_ms)
  values (p_job, p_ok, coalesce(p_counts, '{}'::jsonb), left(p_error, 500), p_duration_ms);
$$;

-- ---------------------------------------------------------------------------
-- 6. Service notices to customers
-- ---------------------------------------------------------------------------

create table private.messages (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('incident', 'billing', 'policy', 'service')),
  subject text not null check (char_length(subject) between 3 and 150 and subject !~ '[\r\n]'),
  body text not null check (char_length(body) between 10 and 5000),
  audience jsonb not null,
  recipients integer not null default 0,
  status text not null default 'draft'
    check (status in ('draft', 'sending', 'sent', 'cancelled')),
  created_by uuid not null references private.staff_members (user_id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
alter table private.messages enable row level security;

create table private.message_sends (
  id bigint generated always as identity primary key,
  message_id uuid not null references private.messages (id) on delete cascade,
  email text not null,
  workspace_id uuid references public.workspaces (id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  provider_id text,
  error text,
  unique (message_id, email)
);
create index message_sends_queue_idx on private.message_sends (id)
  where status in ('queued', 'sending');
alter table private.message_sends enable row level security;

/** Is this a valid audience? Owners of every workspace, of workspaces on
 * some plans, or of chosen workspaces. */
create function private.audience_problem(p jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'audience missing'; end if;
  case p ->> 'type'
    when 'all' then
      if (select count(*) from jsonb_object_keys(p)) <> 1 then return 'unexpected fields'; end if;
    when 'plans' then
      if jsonb_typeof(p -> 'plans') <> 'array' or jsonb_array_length(p -> 'plans') = 0
         or exists (select 1 from jsonb_array_elements_text(p -> 'plans') x
                     where x not in (select id from public.plans)) then
        return 'unknown plan';
      end if;
    when 'workspaces' then
      if jsonb_typeof(p -> 'ids') <> 'array' or jsonb_array_length(p -> 'ids') not between 1 and 500
         or exists (select 1 from jsonb_array_elements_text(p -> 'ids') x
                     where x !~ '^[0-9a-f-]{36}$'
                        or not exists (select 1 from public.workspaces w where w.id = x::uuid)) then
        return 'unknown workspace';
      end if;
    else return 'unknown audience';
  end case;
  return null;
end;
$$;

/** Owners of the audience's workspaces, one row per address. */
create function private.audience_recipients(p jsonb)
returns table (email text, workspace_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (lower(u.email)) lower(u.email), w.id
    from public.workspaces w
    join public.workspace_members m on m.workspace_id = w.id and m.role = 'owner'
    join auth.users u on u.id = m.user_id
   where u.email is not null and u.email_confirmed_at is not null
     and case p ->> 'type'
           when 'all' then true
           when 'plans' then w.plan_id in (select jsonb_array_elements_text(p -> 'plans'))
           when 'workspaces' then w.id in (select x::uuid from jsonb_array_elements_text(p -> 'ids') x)
           else false
         end
   order by lower(u.email), w.created_at;
$$;

/** Writes a notice (it can't be edited afterwards: cancel it and write
 * another). Says how many owners it would reach. */
create function public.admin_message_draft(
  p_kind text,
  p_subject text,
  p_body text,
  p_audience jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_staff uuid := private.check_staff('comms.send');
  v_problem text;
  v_count integer;
  v_id uuid;
begin
  if v_staff is null then return private.denial(); end if;
  v_problem := private.audience_problem(p_audience);
  if v_problem is not null then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'why', v_problem);
  end if;
  if p_kind not in ('incident', 'billing', 'policy', 'service')
     or char_length(btrim(coalesce(p_subject, ''))) not between 3 and 150
     or btrim(p_subject) ~ '[\r\n]'
     or char_length(btrim(coalesce(p_body, ''))) not between 10 and 5000 then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  select count(*) into v_count from private.audience_recipients(p_audience);
  insert into private.messages (kind, subject, body, audience, recipients, created_by)
  values (p_kind, btrim(p_subject), btrim(p_body), p_audience, v_count, v_staff)
  returning id into v_id;
  perform private.log_admin_action(
    v_staff, 'message.drafted', 'succeeded', null, 'message', v_id::text, null, null,
    jsonb_build_object('kind', p_kind, 'recipients', v_count));
  return jsonb_build_object('ok', true, 'id', v_id, 'recipients', v_count);
end;
$$;

create function public.admin_message_list()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_staff uuid := private.check_staff('comms.send');
begin
  if v_staff is null then return private.denial(); end if;
  return jsonb_build_object('ok', true, 'messages', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'kind', m.kind, 'subject', m.subject, 'body', m.body,
      'audience', m.audience, 'recipients', m.recipients, 'status', m.status,
      'created_at', m.created_at, 'started_at', m.started_at, 'finished_at', m.finished_at,
      'created_by_name', s.display_name,
      'sent', (select count(*) from private.message_sends x
                where x.message_id = m.id and x.status = 'sent'),
      'failed', (select count(*) from private.message_sends x
                  where x.message_id = m.id and x.status = 'failed'),
      'waiting', (select count(*) from private.message_sends x
                   where x.message_id = m.id and x.status in ('queued', 'sending')),
      'pending_request', (select c.id from private.change_requests c
                           where c.action = 'message.send' and c.target_id = m.id::text
                             and c.status in ('pending', 'approved') and c.expires_at > now()
                           limit 1))
      order by m.created_at desc)
      from (select * from private.messages order by created_at desc limit 50) m
      left join private.staff_members s on s.user_id = m.created_by), '[]'::jsonb));
end;
$$;

/** Stops a draft, or the rest of a send in progress. */
create function public.admin_message_cancel(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_staff uuid := private.check_staff('comms.send');
begin
  if v_staff is null then return private.denial(); end if;
  update private.messages set status = 'cancelled', finished_at = now()
   where id = p_id and status in ('draft', 'sending');
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  update private.message_sends set status = 'skipped'
   where message_id = p_id and status = 'queued';
  perform private.log_admin_action(v_staff, 'message.cancelled', 'succeeded', null,
                                   'message', p_id::text);
  return jsonb_build_object('ok', true);
end;
$$;

/** Starts sending an approved notice: the approval binds its exact
 * wording and audience. At most five notices start a day. */
create function public.admin_apply_message_send(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare
  v_staff uuid;
  v_change private.change_requests;
  v_msg private.messages;
  v_count integer;
begin
  v_staff := private.check_staff('comms.send', true);
  if v_staff is null then return private.denial(); end if;
  select * into v_change from private.change_requests where id = p_request_id;
  if not found or v_change.action <> 'message.send' then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into v_msg from private.messages where id = v_change.target_id::uuid for update;
  if not found or v_msg.status <> 'draft'
     or v_change.payload is distinct from jsonb_build_object(
          'kind', v_msg.kind, 'subject', v_msg.subject, 'body', v_msg.body,
          'audience', v_msg.audience) then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'why', 'notice does not match');
  end if;
  if (select count(*) from private.messages
       where started_at > now() - interval '1 day') >= 5 then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'why', 'daily_limit');
  end if;
  if private.consume_approval(p_request_id, v_change.action, v_change.target_id, v_change.payload)
     is null then
    perform private.log_admin_action(
      v_staff, 'message.send', 'denied', 'no approved request', 'message', v_msg.id::text,
      null, p_request_id, '{}'::jsonb);
    return jsonb_build_object('ok', false, 'code', 'approval_required');
  end if;
  insert into private.message_sends (message_id, email, workspace_id)
  select v_msg.id, r.email, r.workspace_id from private.audience_recipients(v_msg.audience) r;
  get diagnostics v_count = row_count;
  update private.messages
     set status = case when v_count = 0 then 'sent' else 'sending' end,
         recipients = v_count, started_at = now(),
         finished_at = case when v_count = 0 then now() end
   where id = v_msg.id;
  perform private.log_admin_action(
    v_staff, 'message.send', 'succeeded', v_change.reason, 'message', v_msg.id::text, null,
    p_request_id, jsonb_build_object('kind', v_msg.kind, 'recipients', v_count));
  return jsonb_build_object('ok', true, 'recipients', v_count);
end;
$$;

/** The next sends for the ops job (a send left half-done for 10 minutes
 * is tried again; three tries at most). */
create function public.ops_message_claim(p_limit integer default 50)
returns table (id bigint, email text, kind text, subject text, body text)
language sql
security definer
set search_path = ''
as $$
  with next as (
    select s.id from private.message_sends s
      join private.messages m on m.id = s.message_id and m.status = 'sending'
     where (s.status = 'queued'
            or (s.status = 'sending' and s.claimed_at < now() - interval '10 minutes'))
       and s.attempts < 3
     order by s.id
     limit least(greatest(p_limit, 1), 100)
     for update of s skip locked)
  update private.message_sends s
     set status = 'sending', claimed_at = now(), attempts = s.attempts + 1
    from next, private.messages m
   where s.id = next.id and m.id = s.message_id
  returning s.id, s.email, m.kind, m.subject, m.body;
$$;

create function public.ops_message_result(
  p_id bigint,
  p_ok boolean,
  p_provider_id text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message uuid;
begin
  update private.message_sends
     set status = case when p_ok then 'sent' when attempts >= 3 then 'failed' else 'queued' end,
         sent_at = case when p_ok then now() end,
         provider_id = left(p_provider_id, 120),
         error = case when p_ok then null else left(p_error, 300) end
   where id = p_id and status = 'sending'
  returning message_id into v_message;
  if v_message is not null and not exists (
       select 1 from private.message_sends
        where message_id = v_message and status in ('queued', 'sending')) then
    update private.messages set status = 'sent', finished_at = now()
     where id = v_message and status = 'sending';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Checks for the ops job
-- ---------------------------------------------------------------------------

/** Deadlines, retention runs and stuck queues (run every 5 minutes by
 * the ops job, which emails what it raises). */
create function public.ops_phase4_checks()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_overdue integer;
  v_soon integer;
  v_failed text[];
  v_last timestamptz;
  v_stuck integer;
begin
  select count(*) filter (where due_at < now()),
         count(*) filter (where due_at between now() and now() + interval '5 days')
    into v_overdue, v_soon
    from private.privacy_requests where status = 'open';
  if v_overdue > 0 then
    perform private.raise_alert('privacy_overdue', 'critical',
      format('%s privacy request(s) passed their 30-day deadline.', v_overdue),
      jsonb_build_object('count', v_overdue));
  else
    perform private.resolve_alert('privacy_overdue');
  end if;
  if v_soon > 0 then
    perform private.raise_alert('privacy_due_soon', 'warning',
      format('%s privacy request(s) are due within 5 days.', v_soon),
      jsonb_build_object('count', v_soon));
  else
    perform private.resolve_alert('privacy_due_soon');
  end if;

  select array_agg(job order by job) into v_failed
    from (select distinct on (job) job, ok from private.retention_runs
           where job <> 'setup' order by job, ran_at desc) latest
   where not ok;
  if v_failed is not null then
    perform private.raise_alert('retention_failing', 'critical',
      format('The retention run failed for: %s.', array_to_string(v_failed, ', ')),
      jsonb_build_object('jobs', to_jsonb(v_failed)));
  else
    perform private.resolve_alert('retention_failing');
  end if;
  select max(ran_at) into v_last from private.retention_runs;
  if v_last < now() - interval '26 hours' then
    perform private.raise_alert('retention_stale', 'critical',
      format('Retention hasn''t run since %s.', to_char(v_last, 'YYYY-MM-DD HH24:MI "UTC"')),
      '{}'::jsonb);
  else
    perform private.resolve_alert('retention_stale');
  end if;

  select count(*) into v_stuck from private.storage_deletions
   where done_at is null and (attempts >= 10 or queued_at < now() - interval '1 day');
  if v_stuck > 0 then
    perform private.raise_alert('file_removal_stuck', 'warning',
      format('%s erased file(s) couldn''t be removed from storage.', v_stuck),
      jsonb_build_object('count', v_stuck));
  else
    perform private.resolve_alert('file_removal_stuck');
  end if;

  select count(*) into v_stuck from private.message_sends s
    join private.messages m on m.id = s.message_id
   where s.status = 'failed' and m.started_at > now() - interval '7 days';
  if v_stuck > 0 then
    perform private.raise_alert('notices_failed', 'warning',
      format('%s customer notice email(s) failed in the last week.', v_stuck),
      jsonb_build_object('count', v_stuck));
  else
    perform private.resolve_alert('notices_failed');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------

-- The answers index runs this on every insert, as whoever inserts, so
-- those roles need EXECUTE. It is a pure function, and without USAGE on
-- the private schema nobody can call it directly.
revoke all on function private.answer_email(jsonb) from public;
grant execute on function private.answer_email(jsonb) to anon, authenticated, service_role;
revoke all on function private.person_responses(text) from public, anon, authenticated;
revoke all on function private.audience_problem(jsonb) from public, anon, authenticated;
revoke all on function private.audience_recipients(jsonb) from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.ops_storage_deletions_claim(integer)',
    'public.ops_storage_deletions_done(bigint[], text)',
    'public.ops_record_retention_run(text, boolean, jsonb, text, integer)',
    'public.ops_message_claim(integer)',
    'public.ops_message_result(bigint, boolean, text, text)',
    'public.ops_phase4_checks()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.admin_privacy_open(text, text, timestamptz, text)',
    'public.admin_privacy_overview()',
    'public.admin_privacy_get(uuid)',
    'public.admin_privacy_verify(uuid, text)',
    'public.admin_privacy_find(uuid)',
    'public.admin_privacy_export(uuid)',
    'public.admin_apply_privacy_erasure(uuid)',
    'public.admin_privacy_close(uuid, text, text)',
    'public.admin_message_draft(text, text, text, jsonb)',
    'public.admin_message_list()',
    'public.admin_message_cancel(uuid)',
    'public.admin_apply_message_send(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
