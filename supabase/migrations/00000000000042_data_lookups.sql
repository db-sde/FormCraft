-- External data during a response (logic spec phase 24): after a chosen
-- question is answered, the server calls the creator's API and puts
-- fields from its JSON reply into the form's URL fields, where rules and
-- recall can use them. Configured per form (like payment settings), kept
-- out of the versioned schema — which is sent to browsers — because it
-- holds a URL and a secret header.

update public.plans
  set entitlements = entitlements
    || jsonb_build_object('data_lookups', id in ('business', 'enterprise'));

create table public.form_lookups (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  -- Runs when the respondent leaves this question.
  trigger_question_id text not null check (trigger_question_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  -- GET only. May contain {{answer:<question id>}} tokens in its path or
  -- query, never in its host.
  url text not null check (length(url) between 10 and 2000),
  header_name text check (header_name ~ '^[A-Za-z0-9-]{1,64}$'),
  -- { iv, authTag, ciphertext } of the header's value (AES-256-GCM).
  encrypted_header jsonb,
  -- [{ field: <URL field name>, path: <JSON path in the reply> }]
  outputs jsonb not null check (jsonb_typeof(outputs) = 'array'),
  enabled boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((header_name is null) = (encrypted_header is null))
);
create index form_lookups_form_idx on public.form_lookups (form_id);
-- No policies: the server reads and writes lookups after its own checks.
alter table public.form_lookups enable row level security;
create policy "mfa: second factor when enrolled" on public.form_lookups as restrictive
  for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

-- How many lookups a response has triggered (capped by the server).
alter table public.responses
  add column lookup_calls integer not null default 0 check (lookup_calls >= 0);
