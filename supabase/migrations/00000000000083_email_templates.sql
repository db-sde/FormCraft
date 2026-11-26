-- Custom email templates (developer spec 26 Nov 2026, item 2; Starter and
-- up). A creator writes the emails a form sends in their own words and
-- brand, with answers from the response:
--
--   kind                 scope            recipient
--   confirmation         a form           the respondent
--   owner_notification   a form           the form's owner
--   rule                 a rule           teammates the rule matches
--   booking_confirmation a booking type   the attendee
--   booking_reminder     a booking type   the attendee
--   saved                the workspace    (a template to start others from)
--
-- The body is structured blocks (rendered by the app into table-based
-- HTML and plain text), never raw HTML. Each form publish snapshots the
-- form's templates, so a sent email can be traced to the template it used.
-- Members read; members who manage integrations change them. The plan is
-- checked by the app on save and again on every send.

create table public.email_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in ('confirmation', 'owner_notification', 'rule',
                                     'booking_confirmation', 'booking_reminder', 'saved')),
  form_id uuid references public.forms (id) on delete cascade,
  rule_id uuid references public.notification_rules (id) on delete cascade,
  booking_type_id uuid references public.booking_types (id) on delete cascade,
  name text check (name is null or length(btrim(name)) between 1 and 60),
  subject text not null check (char_length(subject) between 1 and 150),
  preheader text check (preheader is null or char_length(preheader) <= 120),
  sender_name text check (sender_name is null or (char_length(sender_name) <= 60
                                                  and sender_name !~ '[<>"@,;\r\n]')),
  reply_to jsonb not null default '{"mode": "owner"}'::jsonb
    check (jsonb_typeof(reply_to) = 'object'),
  body jsonb not null check (jsonb_typeof(body) = 'object' and pg_column_size(body) <= 102400),
  rendered_html_cache text check (rendered_html_cache is null
                                  or char_length(rendered_html_cache) <= 200000),
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_templates_scope check (
    (kind in ('confirmation', 'owner_notification') and form_id is not null
       and rule_id is null and booking_type_id is null)
    or (kind = 'rule' and rule_id is not null and booking_type_id is null)
    or (kind in ('booking_confirmation', 'booking_reminder') and booking_type_id is not null
       and form_id is null and rule_id is null)
    or (kind = 'saved' and name is not null and form_id is null and rule_id is null
       and booking_type_id is null)
  )
);
create unique index email_templates_form_kind on public.email_templates (form_id, kind)
  where kind in ('confirmation', 'owner_notification');
create unique index email_templates_rule on public.email_templates (rule_id) where kind = 'rule';
create unique index email_templates_booking on public.email_templates (booking_type_id, kind)
  where kind in ('booking_confirmation', 'booking_reminder');
create index email_templates_workspace on public.email_templates (workspace_id, kind);

alter table public.email_templates enable row level security;
create policy "email_templates: members read" on public.email_templates
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "email_templates: integration managers insert" on public.email_templates
  for insert to authenticated
  with check (public.can_edit_workspace(workspace_id)
              and public.has_permission(workspace_id, 'manage_integrations'));
create policy "email_templates: integration managers update" on public.email_templates
  for update to authenticated
  using (public.can_edit_workspace(workspace_id)
         and public.has_permission(workspace_id, 'manage_integrations'))
  with check (public.can_edit_workspace(workspace_id)
              and public.has_permission(workspace_id, 'manage_integrations'));
create policy "email_templates: integration managers delete" on public.email_templates
  for delete to authenticated
  using (public.can_edit_workspace(workspace_id)
         and public.has_permission(workspace_id, 'manage_integrations'));
revoke all on public.email_templates from anon, authenticated;
grant select, insert, update, delete on public.email_templates to authenticated;
grant all on public.email_templates to service_role;

-- A template's form, rule or booking type must be in its workspace.
create function private.email_template_in_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.form_id is not null and not exists (
       select 1 from public.forms f where f.id = new.form_id and f.workspace_id = new.workspace_id) then
    raise exception 'form is in another workspace' using errcode = '42501';
  end if;
  if new.rule_id is not null and not exists (
       select 1 from public.notification_rules r join public.forms f on f.id = r.form_id
        where r.id = new.rule_id and f.workspace_id = new.workspace_id) then
    raise exception 'rule is in another workspace' using errcode = '42501';
  end if;
  if new.booking_type_id is not null and not exists (
       select 1 from public.booking_types b
        where b.id = new.booking_type_id and b.workspace_id = new.workspace_id) then
    raise exception 'booking type is in another workspace' using errcode = '42501';
  end if;
  if new.kind = 'saved' and tg_op = 'INSERT' and (
       select count(*) from public.email_templates t
        where t.workspace_id = new.workspace_id and t.kind = 'saved') >= 50 then
    raise exception 'a workspace can keep up to 50 saved templates' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger email_templates_check before insert or update on public.email_templates
  for each row execute function private.email_template_in_workspace();

create table public.email_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.email_templates (id) on delete cascade,
  form_version_id uuid not null references public.form_versions (id) on delete cascade,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (template_id, form_version_id)
);
alter table public.email_template_versions enable row level security;
create policy "email_template_versions: members read" on public.email_template_versions
  for select to authenticated using (exists (
    select 1 from public.email_templates t
     where t.id = template_id and public.is_workspace_member(t.workspace_id)));
revoke all on public.email_template_versions from anon, authenticated;
grant select on public.email_template_versions to authenticated;
grant all on public.email_template_versions to service_role;

/** On publish: snapshot the form's templates (its own and its rules')
 * against the new version. Service role (called by the publish path). */
create function public.snapshot_email_templates(p_form_id uuid, p_form_version_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  insert into public.email_template_versions (template_id, form_version_id, snapshot)
  select t.id, p_form_version_id,
         jsonb_build_object('kind', t.kind, 'subject', t.subject, 'preheader', t.preheader,
                            'sender_name', t.sender_name, 'reply_to', t.reply_to,
                            'body', t.body, 'updated_at', t.updated_at)
    from public.email_templates t
   where t.form_id = p_form_id
      or t.rule_id in (select r.id from public.notification_rules r where r.form_id = p_form_id)
  on conflict (template_id, form_version_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.snapshot_email_templates(uuid, uuid) from public, anon, authenticated;
grant execute on function public.snapshot_email_templates(uuid, uuid) to service_role;
