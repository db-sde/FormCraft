-- Hardening (2026-11-03): background work every minute, not once a day.
--
-- Vercel's free plan runs crons at most daily, so a failed webhook,
-- Sheets row or app sync could wait a day to retry, and booking reminders
-- could be missed. Supabase's own scheduler (pg_cron) calls the same cron
-- endpoints through pg_net instead: the queues every minute, digests
-- hourly (each is sent once per local day), domain checks every six
-- hours, retention daily. vercel.json's daily crons stay as a fallback.
--
-- The app URL and CRON_SECRET aren't in this file: after deploying, run
--   select public.schedule_background_jobs('https://app.example.com', '<CRON_SECRET>');
-- once (as the postgres role). They're kept in Supabase Vault.
-- `select public.unschedule_background_jobs();` turns it off.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Calls one cron endpoint with the stored secret. Fire-and-forget: the
-- endpoint does the work and records its own outcome.
create function public.call_cron_endpoint(p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'formcraft_app_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'formcraft_cron_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || p_path,
    headers := jsonb_build_object(
      'authorization', 'Bearer ' || v_secret,
      'content-type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

create function public.schedule_background_jobs(p_app_url text, p_cron_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_app_url !~ '^https?://[^/]+$' then
    raise exception 'app url must be like https://app.example.com (no path)';
  end if;
  if length(coalesce(p_cron_secret, '')) < 16 then
    raise exception 'cron secret is too short';
  end if;
  select id into v_id from vault.secrets where name = 'formcraft_app_url';
  if v_id is null then
    perform vault.create_secret(p_app_url, 'formcraft_app_url');
  else
    perform vault.update_secret(v_id, p_app_url);
  end if;
  v_id := null;
  select id into v_id from vault.secrets where name = 'formcraft_cron_secret';
  if v_id is null then
    perform vault.create_secret(p_cron_secret, 'formcraft_cron_secret');
  else
    perform vault.update_secret(v_id, p_cron_secret);
  end if;

  perform cron.schedule('formcraft-webhooks', '* * * * *',
    $j$select public.call_cron_endpoint('/api/cron/webhooks/dispatch')$j$);
  perform cron.schedule('formcraft-sheets', '* * * * *',
    $j$select public.call_cron_endpoint('/api/cron/sheets/dispatch')$j$);
  perform cron.schedule('formcraft-connectors', '* * * * *',
    $j$select public.call_cron_endpoint('/api/cron/connectors')$j$);
  perform cron.schedule('formcraft-digests', '5 * * * *',
    $j$select public.call_cron_endpoint('/api/cron/digests')$j$);
  perform cron.schedule('formcraft-domains', '20 */6 * * *',
    $j$select public.call_cron_endpoint('/api/cron/domains')$j$);
  perform cron.schedule('formcraft-retention', '30 3 * * *',
    $j$select public.call_cron_endpoint('/api/cron/retention')$j$);
end;
$$;

create function public.unschedule_background_jobs()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job text;
begin
  foreach v_job in array array[
    'formcraft-webhooks', 'formcraft-sheets', 'formcraft-connectors',
    'formcraft-digests', 'formcraft-domains', 'formcraft-retention'
  ] loop
    if exists (select 1 from cron.job where jobname = v_job) then
      perform cron.unschedule(v_job);
    end if;
  end loop;
end;
$$;

revoke all on function public.call_cron_endpoint(text) from public, anon, authenticated, service_role;
revoke all on function public.schedule_background_jobs(text, text) from public, anon, authenticated, service_role;
revoke all on function public.unschedule_background_jobs() from public, anon, authenticated, service_role;
