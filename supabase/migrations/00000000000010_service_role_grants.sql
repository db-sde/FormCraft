-- Same root cause as migration 00000000000007_grants.sql, but for
-- `service_role`: this Supabase version does not auto-grant table
-- privileges to ANY Data API role, including service_role. Bypassing
-- RLS (which service_role does) is a separate mechanism from having
-- the underlying SQL privilege at all — without this, the admin
-- client used by the public response API route handlers
-- (src/lib/supabase/admin.ts) fails with "permission denied for
-- table X" even though RLS itself is correctly bypassed.
--
-- service_role is trusted server-side code only (never reaches the
-- browser — see admin.ts), so granting it full privileges on every
-- application table is the intended posture, not a widening beyond
-- what it's already meant to be able to do.

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Keep this true for tables/sequences/functions added by future
-- migrations too, so this class of bug can't recur silently.
alter default privileges in schema public
  grant all privileges on tables to service_role;
alter default privileges in schema public
  grant all privileges on sequences to service_role;
alter default privileges in schema public
  grant execute on functions to service_role;
