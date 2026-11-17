-- Table permissions, stated in full (2026-11-13).
--
-- Until now the migrations only ADDED the permissions each table needs
-- (migration 7 onwards) and relied on the Supabase stack giving the
-- public roles nothing by default. That default is not the same
-- everywhere: a database built from these migrations with a different
-- CLI or project setting starts every table with ALL privileges for
-- `anon` and `authenticated`, which silently undoes the column-level
-- limits (a lookup's encrypted header, an SSO provider id, a webhook's
-- secret) and leaves row-level security as the only guard. CI found it:
-- the same migrations passed locally and failed on a fresh database.
--
-- This migration makes the result the same wherever it runs: take
-- everything away from the two public roles, then grant back exactly
-- what the earlier migrations intended. On a database that already had
-- the strict default, the only change is that the leftover TRUNCATE,
-- REFERENCES, TRIGGER and MAINTAIN privileges go too. Nothing the app
-- uses is added or removed. `service_role` is untouched.

-- New tables, sequences and functions: nothing for the public roles
-- unless a migration grants it. (A new function still starts callable by
-- everyone through PUBLIC, as Postgres does everywhere; a migration that
-- wants it private revokes that, and now that is enough.)
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

-- Existing ones: start from nothing. Revoking on a table also drops its
-- column-level grants. No public role inserts into a table with a
-- sequence, so the sequences need no grant back.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Whole-table permissions.
grant select on public.analytics_daily to authenticated;
grant select on public.analytics_events to authenticated;
grant select on public.answers to authenticated;
grant select, update on public.api_keys to authenticated;
grant select on public.audit_logs to authenticated;
grant select, insert, update, delete on public.booking_hosts to authenticated;
grant select, insert, update, delete on public.booking_types to authenticated;
grant select on public.bookings to authenticated;
grant select, insert, update, delete on public.confirmation_emails to authenticated;
grant select on public.connector_jobs to authenticated;
grant select, insert, update, delete on public.connector_links to authenticated;
grant select, insert, delete on public.coupons to authenticated;
grant select, update, delete on public.custom_domains to authenticated;
grant select, insert, update on public.experiments to authenticated;
grant select, insert, update, delete on public.folders to authenticated;
grant select on public.form_ai_summaries to authenticated;
grant select, insert, update, delete on public.form_documents to authenticated;
grant select on public.form_versions to authenticated;
grant select, insert, update, delete on public.forms to authenticated;
grant select, insert, update, delete on public.notification_digests to authenticated;
grant select, insert, update, delete on public.notification_rules to authenticated;
grant select, insert, update, delete on public.notification_settings to authenticated;
grant select on public.payment_attempts to authenticated;
grant select on public.payments to authenticated;
grant select on public.plans to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert on public.question_block_versions to authenticated;
grant select, insert, update on public.question_blocks to authenticated;
grant select on public.response_comments to authenticated;
grant select on public.response_documents to authenticated;
grant select on public.response_events to authenticated;
grant select on public.response_followups to authenticated;
grant select on public.response_insights to authenticated;
grant select on public.response_orders to authenticated;
grant select, delete on public.responses to authenticated;
grant insert, update, delete on public.sheets_connections to authenticated;
grant select on public.sheets_sync_log to authenticated;
grant select on public.templates to authenticated;
grant select on public.uploads to authenticated;
grant select on public.usage_counters to authenticated;
grant select, insert, update on public.variant_tests to authenticated;
grant select on public.webhook_deliveries to authenticated;
grant insert, update, delete on public.webhook_endpoints to authenticated;
grant select, update on public.workspace_invitations to authenticated;
grant select, insert, update, delete on public.workspace_members to authenticated;
grant select on public.workspace_sso to authenticated;
grant select, insert, update, delete on public.workspaces to authenticated;

-- Only these columns: the rest of each table (secrets, ids the
-- database sets) stays out of reach.
grant update (code, kind, percent_off, amount_off, expires_at, max_uses, active)
  on public.coupons to authenticated;
grant select (id, form_id, name, trigger_question_id, url, header_name, outputs, enabled, created_at)
  on public.form_lookups to authenticated;
grant insert (form_id, version_number, schema)
  on public.form_versions to authenticated;
grant update (schema, revision)
  on public.form_versions to authenticated;
grant select (id, workspace_id, form_id, spreadsheet_id, enabled, created_at, updated_at)
  on public.sheets_connections to authenticated;
grant select (id, form_id, url, enabled, created_at, updated_at, kind, config, api_key_id)
  on public.webhook_endpoints to authenticated;
grant update (enforced, default_role)
  on public.workspace_sso to authenticated;

-- Functions. Who can call each one is the same in every environment
-- today, but where the stack grants by default each role also holds its
-- own copy of the permission, so a later "revoke ... from public" would
-- quietly not apply there. Drop those copies and keep only the grants
-- the earlier migrations made on purpose.
revoke execute on all functions in schema public from anon, authenticated;

grant execute on function public.analytics_rolled_count(p_form_id uuid, p_event_type text, p_since date) to authenticated;
grant execute on function public.connector_status(p_workspace_id uuid) to authenticated;
grant execute on function public.create_form_with_draft(p_workspace_id uuid, p_title text, p_slug text, p_schema jsonb, p_created_by uuid) to authenticated;
grant execute on function public.create_workspace_with_owner(workspace_name text, workspace_slug text) to authenticated;
grant execute on function public.experiment_stats(target_experiment_id uuid) to authenticated;
grant execute on function public.form_embed_origins(p_slug text) to anon, authenticated;
grant execute on function public.has_permission(target_workspace_id uuid, permission text) to authenticated;
grant execute on function public.integration_status(p_workspace_id uuid) to authenticated;
grant execute on function public.is_workspace_member(target_workspace_id uuid) to authenticated;
grant execute on function public.jwt_has_sso(claims jsonb) to authenticated;
grant execute on function public.list_leads(p_workspace_id uuid, p_form_id uuid, p_search text, p_limit integer, p_offset integer) to authenticated;
grant execute on function public.mfa_satisfied() to authenticated;
grant execute on function public.publish_question_block_version(p_block_id uuid, p_questions jsonb) to authenticated;
grant execute on function public.resolve_custom_domain(p_hostname text) to anon, authenticated;
grant execute on function public.response_dropoff(target_form_id uuid, idle_minutes integer) to authenticated;
grant execute on function public.response_is_confidential(p_form_id uuid) to authenticated;
grant execute on function public.response_reach(target_form_id uuid, since timestamp with time zone) to authenticated;
grant execute on function public.response_source_conversion(target_form_id uuid, since timestamp with time zone) to authenticated;
grant execute on function public.responses_by_email(p_workspace_id uuid, p_email text) to authenticated;
grant execute on function public.scim_status(p_workspace_id uuid) to authenticated;
grant execute on function public.sso_satisfied(target_workspace_id uuid) to authenticated;
grant execute on function public.unpublish_form(target_form_id uuid) to authenticated;
grant execute on function public.workspace_role_for(target_workspace_id uuid) to authenticated;
grant execute on function public.workspaces_requiring_sso() to authenticated;
