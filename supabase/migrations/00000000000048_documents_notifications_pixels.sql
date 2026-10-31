-- Master spec Phase 3 (2026-10-30): PDF documents (F-07), advanced email
-- notifications (F-25), and LinkedIn / TikTok pixels with consent (F-44).
-- Embed analytics (F-24) reuse analytics_events (event_type is free text).

-- 1. Documents a form can issue. One of each kind per form; the settings
-- are the template's editable text, colour, logo and number prefix, plus
-- (for certificates) the condition a response must meet. PDFs aren't
-- stored: they're rebuilt from the response on demand (product owner,
-- 2026-10-30). Recipients: owner, respondent, both or neither, plus
-- workspace members only.
create table public.form_documents (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete cascade,
  kind text not null check (kind in ('summary', 'order', 'registration', 'certificate')),
  enabled boolean not null default true,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  recipients text not null default 'none'
    check (recipients in ('owner', 'respondent', 'both', 'none')),
  member_ids uuid[] not null default '{}' check (cardinality(member_ids) <= 20),
  -- The next number to issue (numbering is per form and kind).
  next_number integer not null default 1 check (next_number >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (form_id, kind)
);

-- 2. A document issued to a response: its number, fixed once given, and
-- when it was emailed (claimed once, so a repeat trigger never resends).
create table public.response_documents (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.form_documents (id) on delete cascade,
  response_id uuid not null references public.responses (id) on delete cascade,
  number integer not null check (number >= 1),
  issued_at timestamptz not null default now(),
  emailed_at timestamptz,
  unique (document_id, response_id),
  unique (document_id, number)
);
create index response_documents_response_idx on public.response_documents (response_id);

-- Issues (or returns the existing) number for a response, in one
-- transaction with a row lock, so racing triggers can't skip or reuse a
-- number. Service role only.
create function public.issue_response_document(p_document_id uuid, p_response_id uuid)
returns table (id uuid, number integer, issued_at timestamptz, emailed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number integer;
begin
  -- Lock the document first: racing calls for it queue here, so the
  -- second sees the first's row (or takes the next number) and no number
  -- is ever skipped or reused.
  perform 1 from public.form_documents fd where fd.id = p_document_id for update;
  if not found then
    raise exception 'document not found';
  end if;

  return query
    select rd.id, rd.number, rd.issued_at, rd.emailed_at
    from public.response_documents rd
    where rd.document_id = p_document_id and rd.response_id = p_response_id;
  if found then
    return;
  end if;

  update public.form_documents fd
    set next_number = fd.next_number + 1, updated_at = now()
    where fd.id = p_document_id
    returning fd.next_number - 1 into v_number;

  return query
    insert into public.response_documents as rd (document_id, response_id, number)
    values (p_document_id, p_response_id, v_number)
    returning rd.id, rd.number, rd.issued_at, rd.emailed_at;
end;
$$;
revoke all on function public.issue_response_document(uuid, uuid) from public, anon, authenticated;
grant execute on function public.issue_response_document(uuid, uuid) to service_role;

-- 3. Notification rules (F-25): who on the team hears about a response,
-- when (an optional condition on the answers), with what subject. Only
-- workspace members are recipients.
create table public.notification_rules (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  enabled boolean not null default true,
  member_ids uuid[] not null check (cardinality(member_ids) between 1 and 20),
  condition jsonb check (condition is null or jsonb_typeof(condition) = 'object'),
  subject text check (subject is null or char_length(subject) <= 200),
  -- Answers stay out of email unless the creator turns this on.
  include_answers boolean not null default false,
  attach_document text check (attach_document is null or attach_document in
    ('summary', 'order', 'registration', 'certificate')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notification_rules_form_idx on public.notification_rules (form_id);

-- 4. The daily digest: one per form, for the previous day in its time
-- zone, sent once per day (last_sent_on).
create table public.notification_digests (
  form_id uuid primary key references public.forms (id) on delete cascade,
  enabled boolean not null default true,
  member_ids uuid[] not null check (cardinality(member_ids) between 1 and 20),
  time_zone text not null default 'UTC' check (char_length(time_zone) between 1 and 64),
  last_sent_on date,
  updated_at timestamptz not null default now()
);

-- 5. Timeline kinds for documents and rule emails.
alter table public.response_events drop constraint response_events_kind_check;
alter table public.response_events add constraint response_events_kind_check check (kind in (
  'email_owner', 'email_respondent', 'replay', 'status_changed', 'assigned', 'commented',
  'document_emailed', 'email_rule'
));

-- 6. LinkedIn Insight Tag and TikTok Pixel (F-44), and whether pixels wait
-- for the respondent's consent.
alter table public.forms
  add column linkedin_partner_id text check (linkedin_partner_id ~ '^[0-9]{4,10}$'),
  add column linkedin_conversion_id text check (linkedin_conversion_id ~ '^[0-9]{4,12}$'),
  add column tiktok_pixel_id text check (tiktok_pixel_id ~ '^[A-Z0-9]{15,25}$'),
  add column pixel_consent text not null default 'none'
    check (pixel_consent in ('none', 'ask'));

-- Row-level security. Configuration: members read, editors write. Issued
-- documents: read with the right to read responses; written by the
-- server only.
alter table public.form_documents enable row level security;
alter table public.response_documents enable row level security;
alter table public.notification_rules enable row level security;
alter table public.notification_digests enable row level security;

create policy "mfa: second factor when enrolled" on public.form_documents as restrictive
  for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
create policy "mfa: second factor when enrolled" on public.response_documents as restrictive
  for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
create policy "mfa: second factor when enrolled" on public.notification_rules as restrictive
  for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
create policy "mfa: second factor when enrolled" on public.notification_digests as restrictive
  for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

create policy "form_documents: members read" on public.form_documents
  for select using (exists (
    select 1 from public.forms f where f.id = form_id and public.is_workspace_member(f.workspace_id)
  ));
create policy "form_documents: editors write" on public.form_documents
  for all using (exists (
    select 1 from public.forms f where f.id = form_id and public.can_edit_workspace(f.workspace_id)
  )) with check (exists (
    select 1 from public.forms f where f.id = form_id and public.can_edit_workspace(f.workspace_id)
  ));

create policy "response_documents: permitted members read" on public.response_documents
  for select using (exists (
    select 1 from public.responses r join public.forms f on f.id = r.form_id
    where r.id = response_id and public.has_permission(f.workspace_id, 'view_responses')
  ));

create policy "notification_rules: members read" on public.notification_rules
  for select using (exists (
    select 1 from public.forms f where f.id = form_id and public.is_workspace_member(f.workspace_id)
  ));
create policy "notification_rules: editors write" on public.notification_rules
  for all using (exists (
    select 1 from public.forms f where f.id = form_id and public.can_edit_workspace(f.workspace_id)
  )) with check (exists (
    select 1 from public.forms f where f.id = form_id and public.can_edit_workspace(f.workspace_id)
  ));

create policy "notification_digests: members read" on public.notification_digests
  for select using (exists (
    select 1 from public.forms f where f.id = form_id and public.is_workspace_member(f.workspace_id)
  ));
create policy "notification_digests: editors write" on public.notification_digests
  for all using (exists (
    select 1 from public.forms f where f.id = form_id and public.can_edit_workspace(f.workspace_id)
  )) with check (exists (
    select 1 from public.forms f where f.id = form_id and public.can_edit_workspace(f.workspace_id)
  ));

revoke all on public.form_documents, public.response_documents, public.notification_rules,
  public.notification_digests from anon;
grant select, insert, update, delete on public.form_documents, public.notification_rules,
  public.notification_digests to authenticated;
grant select on public.response_documents to authenticated;
grant select, insert, update, delete on public.form_documents, public.response_documents,
  public.notification_rules, public.notification_digests to service_role;
