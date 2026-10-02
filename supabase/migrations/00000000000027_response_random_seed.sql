-- Question pools and shuffled options (logic spec phase 19): the seed a
-- response was randomised with, so the server's walk asks the same pool
-- questions the respondent was shown. Null for responses from before
-- (and forms without pools behave identically either way).

alter table public.responses
  add column random_seed text check (random_seed ~ '^[A-Za-z0-9_-]{8,64}$');
