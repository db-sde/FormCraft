-- Custom domains (PRD P2.2): forms.customer.com serving a workspace's
-- published forms. Ownership is proven with a DNS TXT record; only
-- verified domains are routed, and a domain whose record disappears
-- goes to "error" and stops routing.

create table public.custom_domains (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- Lowercase hostname, no scheme/port/path.
  hostname text not null unique
    check (hostname ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$'
           and length(hostname) <= 253),
  status text not null default 'pending' check (status in ('pending', 'verified', 'error')),
  -- Published in the TXT record; random, not secret.
  verification_token text not null check (verification_token ~ '^[0-9a-f]{32}$'),
  -- What the bare domain opens; other forms are at /<slug>.
  default_form_id uuid references public.forms (id) on delete set null,
  verified_at timestamptz,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create index custom_domains_workspace_id_idx on public.custom_domains (workspace_id);

alter table public.custom_domains enable row level security;
create policy "custom_domains: members can read" on public.custom_domains
  for select using (public.is_workspace_member(workspace_id));
-- Admins pick the default form and remove domains; adding goes through
-- the server (plan limit, hostname rules), and status only ever changes
-- from a DNS check made by the server.
create policy "custom_domains: admins can update" on public.custom_domains
  for update using (public.can_admin_workspace(workspace_id))
  with check (public.can_admin_workspace(workspace_id));
create policy "custom_domains: admins can delete" on public.custom_domains
  for delete using (public.can_admin_workspace(workspace_id));
grant select, update, delete on public.custom_domains to authenticated;

create function public.protect_custom_domain_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    new.status := old.status;
    new.verification_token := old.verification_token;
    new.verified_at := old.verified_at;
    new.last_checked_at := old.last_checked_at;
    new.last_error := old.last_error;
    new.hostname := old.hostname;
    new.workspace_id := old.workspace_id;
  end if;
  if new.default_form_id is not null and not exists (
    select 1 from public.forms f
    where f.id = new.default_form_id and f.workspace_id = new.workspace_id
  ) then
    raise exception 'That form belongs to another workspace.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger custom_domains_protect_status
  before update on public.custom_domains
  for each row execute function public.protect_custom_domain_status();

-- What the request proxy needs for a hostname: only verified domains,
-- only the id and the default form's slug. Callable without a session.
create function public.resolve_custom_domain(p_hostname text)
returns table (domain_id uuid, default_slug text)
language sql
security definer
stable
set search_path = public
as $$
  select d.id, f.slug
  from public.custom_domains d
  left join public.forms f
    on f.id = d.default_form_id and f.deleted_at is null
  where d.hostname = lower(p_hostname) and d.status = 'verified';
$$;

grant execute on function public.resolve_custom_domain(text) to anon, authenticated;
