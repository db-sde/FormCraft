-- QA FC4-14: writes to a response (answers, uploads, lookups, submit)
-- need its write secret, a cookie /start sets for that response only.
-- Responses that already exist were started without one, so they're
-- marked as not needing it and can still be finished; every response
-- created from now on needs it.
alter table public.responses
  add column if not exists write_protected boolean not null default false;
alter table public.responses
  alter column write_protected set default true;

comment on column public.responses.write_protected is
  'Writes need the response''s write secret (cookie fc_rt). False only for responses started before secrets existed.';
