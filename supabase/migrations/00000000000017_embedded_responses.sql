-- Whether a response came through an embed on another site (PRD P1.13:
-- embed starts/submissions attributed correctly). Views carry the same
-- flag in analytics_events.metadata.
alter table public.responses
  add column embedded boolean not null default false;
