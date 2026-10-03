-- AI response analysis (Phase 3, Wave B). Everything here is written by
-- the server after its own checks (service role); members who can see
-- responses can read it. Nothing the model says changes a response.

-- Per response: sentiment (P3.5), tags (P3.4), AI lead score (P3.6).
create table public.response_insights (
  response_id uuid primary key references public.responses (id) on delete cascade,
  form_id uuid not null references public.forms (id) on delete cascade,
  sentiment text check (sentiment in ('positive', 'neutral', 'negative', 'mixed')),
  tags text[] not null default '{}'
    check (cardinality(tags) <= 5),
  lead_score integer check (lead_score between 0 and 100),
  lead_reason text check (length(lead_reason) <= 400),
  analyzed_at timestamptz not null default now()
);
create index response_insights_form_idx on public.response_insights (form_id);
create index response_insights_tags_idx on public.response_insights using gin (tags);
alter table public.response_insights enable row level security;
create policy "response_insights: readers of responses" on public.response_insights
  for select using (exists (
    select 1 from public.forms f
    where f.id = form_id and public.has_permission(f.workspace_id, 'view_responses')
  ));
grant select on public.response_insights to authenticated;

-- Per form: a summary of its responses (P3.3), replaced when regenerated.
create table public.form_ai_summaries (
  form_id uuid primary key references public.forms (id) on delete cascade,
  -- { overview, themes: [{ title, description, quotes[] }] }
  summary jsonb not null check (jsonb_typeof(summary) = 'object'),
  response_count integer not null check (response_count >= 0),
  generated_by uuid references public.profiles (id) on delete set null,
  generated_at timestamptz not null default now()
);
alter table public.form_ai_summaries enable row level security;
create policy "form_ai_summaries: readers of responses" on public.form_ai_summaries
  for select using (exists (
    select 1 from public.forms f
    where f.id = form_id and public.has_permission(f.workspace_id, 'view_responses')
  ));
grant select on public.form_ai_summaries to authenticated;

-- What a good lead looks like for this form, in the creator's words (P3.6).
alter table public.forms
  add column ai_lead_criteria text check (length(ai_lead_criteria) <= 1000);

-- Adaptive follow-ups (P3.7): one AI-written follow-up per question per
-- response, and the respondent's answer to it. Kept apart from answers
-- so the form's own questions and validation are untouched.
create table public.response_followups (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.responses (id) on delete cascade,
  question_id text not null check (length(question_id) <= 64),
  prompt text not null check (length(prompt) between 1 and 300),
  answer text check (length(answer) <= 5000),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  unique (response_id, question_id)
);
alter table public.response_followups enable row level security;
create policy "response_followups: readers of responses" on public.response_followups
  for select using (exists (
    select 1 from public.responses r join public.forms f on f.id = r.form_id
    where r.id = response_id and public.has_permission(f.workspace_id, 'view_responses')
  ));
grant select on public.response_followups to authenticated;

-- The 2FA guard from migration 37 covers new tables too.
create policy "mfa: second factor when enrolled" on public.response_insights as restrictive
  for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
create policy "mfa: second factor when enrolled" on public.form_ai_summaries as restrictive
  for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
create policy "mfa: second factor when enrolled" on public.response_followups as restrictive
  for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
