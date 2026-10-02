-- Multilingual forms (PRD P2.21): the language a response was given in.
-- Answers are keyed by the same ids in every language, so reports stay
-- combined; this lets them be split by language too.

alter table public.responses
  add column language text check (language ~ '^[a-z]{2}$');
