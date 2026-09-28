-- Bug fix: the public-read policies for the respondent runtime
-- (/f/[slug]) were scoped `to anon` only. Postgres RLS policies apply
-- only to the exact roles they name, so a *logged-in* visitor — an
-- authenticated Supabase session, running queries as the
-- `authenticated` role rather than `anon` — fell through to no
-- matching SELECT policy at all and got a false "form not found" for
-- every published form, including forms outside their own workspace
-- membership. That breaks the basic "open this form link while signed
-- in" flow (e.g. a creator previewing their own live link, or anyone
-- signed in following someone else's shared form link).
--
-- Fix: extend both policies to the `authenticated` role too, so
-- reading a published, non-deleted form works the same regardless of
-- whether the visitor happens to be logged in.
alter policy "form_versions: anon can read published"
  on public.form_versions
  to anon, authenticated;

alter policy "forms: anon can read non-deleted for slug resolution"
  on public.forms
  to anon, authenticated;
