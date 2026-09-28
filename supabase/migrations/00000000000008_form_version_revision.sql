-- Adds a monotonic revision counter to form_versions so the builder's
-- autosave can use compare-and-set semantics (same pattern as
-- responses.client_revision): a save is only applied if the client's
-- expected revision still matches what's stored, and the server
-- increments it on every successful write. This is what makes two open
-- builder tabs, or a stale request retried after a timeout, safe rather
-- than silently clobbering newer edits.

alter table public.form_versions
  add column revision bigint not null default 0;

-- Immutability trigger (enforce_form_version_immutability) already
-- blocks schema changes once a version leaves 'draft', so revision only
-- ever needs to move while status = 'draft' — no additional constraint
-- needed beyond the existing trigger, which fires on every UPDATE
-- including this column.
