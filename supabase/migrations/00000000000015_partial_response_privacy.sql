-- Privacy controls for unfinished responses (PRD P2.7 / §13).

alter table public.forms
  -- Keep answers from respondents who don't finish. Sensitive forms can
  -- turn this off: then nothing is stored until the final submit.
  add column save_partial_responses boolean not null default true,
  -- Automatically delete unfinished responses this many days after
  -- their last activity; null keeps them.
  add column partial_retention_days integer
    check (partial_retention_days between 1 and 3650);
