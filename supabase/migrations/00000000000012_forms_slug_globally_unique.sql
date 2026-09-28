-- Bug fix: the public respondent runtime (/f/[slug]) looks up a form
-- by slug alone (getPublicFormBySlug), with no workspace in the URL to
-- disambiguate — but forms.slug was only unique *within* a workspace
-- (unique(workspace_id, slug)). Two different workspaces publishing a
-- form with the same slug — trivially likely, since "Untitled form"
-- is the literal default title every new form starts with — makes the
-- public lookup match more than one row and 500 (PGRST116: "multiple
-- rows returned") for a query that expects exactly one. Found via a
-- real E2E test running two workers in parallel, each creating a form
-- from the same default title.
--
-- Fix: slug must be globally unique, matching workspaces.slug's own
-- design. createFormWithDraft (src/domains/forms/queries.ts) already
-- retries with a `-1`/`-2`/... suffix on any "duplicate key" error —
-- that logic was written for same-workspace collisions but works
-- identically for cross-workspace ones once the constraint below
-- makes cross-workspace collisions actually raise that error.
--
-- Existing rows: two different forms can currently share a slug
-- across workspaces (that was legal until this migration). Disambiguate
-- everything but the oldest holder of each slug before adding the new
-- constraint, so this migration is safe to run against a database that
-- already has such collisions (e.g. this local dev database).
with ranked as (
  select
    id,
    slug,
    row_number() over (partition by slug order by created_at asc, id asc) as rn
  from public.forms
)
update public.forms f
set slug = f.slug || '-' || ranked.rn::text
from ranked
where f.id = ranked.id
  and ranked.rn > 1;

alter table public.forms drop constraint forms_workspace_id_slug_key;
alter table public.forms add constraint forms_slug_key unique (slug);
