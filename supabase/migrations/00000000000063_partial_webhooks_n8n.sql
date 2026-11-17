-- Partial-response webhooks (feature 53) and n8n (feature 49), 2026-11-14.
--
-- An endpoint can now ask for more than the completed response:
--   response.partial_saved  answers saved before submitting (coalesced:
--                           at most one per response every 10 minutes)
--   response.abandoned      no activity for the endpoint's idle time
--                           (once per idle spell, never on every save)
--   response.resumed        activity again after an abandoned event
--   response.completed      as before, and still the default
-- The events are in webhook_endpoints.config.events; without that list an
-- endpoint gets response.completed only, as every existing one does.
--
-- One event type can now happen more than once for a response (two idle
-- spells, say), so a delivery is unique by its dedupe key too. Completed
-- deliveries keep the empty key, so "one completed delivery per endpoint
-- and response" holds exactly as before.

alter table public.webhook_endpoints drop constraint webhook_endpoints_kind_check;
alter table public.webhook_endpoints
  add constraint webhook_endpoints_kind_check
  check (kind in ('webhook', 'slack', 'zapier', 'make', 'hubspot', 'n8n'));

alter table public.webhook_deliveries add column dedupe_key text not null default ''
  check (char_length(dedupe_key) <= 64);
alter table public.webhook_deliveries drop constraint webhook_deliveries_one_per_event;
alter table public.webhook_deliveries
  add constraint webhook_deliveries_one_per_event
  unique (endpoint_id, response_id, event_type, dedupe_key);

-- Whether an endpoint asked for an event: its own list, else completed
-- responses only.
create or replace function public.webhook_endpoint_wants(p_config jsonb, p_event text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_config -> 'events') = 'array' then (p_config -> 'events') ? p_event
    else p_event = 'response.completed'
  end;
$$;

-- The recovery sweep: completed responses missing their completed
-- delivery. A partial event for the same response no longer counts as
-- one, and an endpoint that didn't ask for completed responses isn't
-- owed one.
create or replace function public.responses_missing_webhook_delivery(p_limit integer)
returns table (endpoint_id uuid, response_id uuid)
language sql
stable
set search_path = ''
as $$
  select we.id, r.id
  from public.webhook_endpoints we
  join public.responses r on r.form_id = we.form_id
  where we.enabled
    and public.webhook_endpoint_wants(we.config, 'response.completed')
    and r.status = 'completed'
    and not r.spam_suspected
    and r.completed_at > now() - interval '24 hours'
    and r.completed_at >= we.created_at
    and not exists (
      select 1 from public.webhook_deliveries d
      where d.endpoint_id = we.id
        and d.response_id = r.id
        and d.event_type = 'response.completed'
    )
  order by r.completed_at
  limit p_limit;
$$;

-- Unfinished responses idle for longer than an endpoint's idle time
-- (config.abandonAfterMinutes, 5 minutes to a day, 30 when unset), on
-- forms that keep unfinished responses, with no abandoned event yet for
-- this idle spell (the key is the time of the last activity). Only the
-- last week, so turning the event on doesn't flood an endpoint with
-- every old unfinished response.
create or replace function public.responses_due_abandoned_event(p_limit integer)
returns table (endpoint_id uuid, response_id uuid, last_active_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select we.id, r.id, r.last_active_at
  from public.webhook_endpoints we
  join public.forms f on f.id = we.form_id
  join public.responses r on r.form_id = we.form_id
  where we.enabled
    and we.kind in ('webhook', 'n8n')
    and public.webhook_endpoint_wants(we.config, 'response.abandoned')
    and f.save_partial_responses
    and r.status = 'partial'
    and not r.spam_suspected
    and not r.is_preview
    and r.last_active_at >= we.created_at
    and r.last_active_at > now() - interval '7 days'
    and r.last_active_at < now() - make_interval(
      mins => least(1440, greatest(5, coalesce(
        case when (we.config ->> 'abandonAfterMinutes') ~ '^\d{1,4}$'
          then (we.config ->> 'abandonAfterMinutes')::integer end,
        30
      )))
    )
    and not exists (
      select 1 from public.webhook_deliveries d
      where d.endpoint_id = we.id
        and d.response_id = r.id
        and d.event_type = 'response.abandoned'
        and d.dedupe_key = 'a:' || floor(extract(epoch from r.last_active_at))::bigint
    )
  order by r.last_active_at
  limit p_limit;
$$;

revoke execute on function public.webhook_endpoint_wants(jsonb, text) from public, anon, authenticated;
revoke execute on function public.responses_missing_webhook_delivery(integer)
  from public, anon, authenticated;
revoke execute on function public.responses_due_abandoned_event(integer)
  from public, anon, authenticated;
grant execute on function public.webhook_endpoint_wants(jsonb, text) to service_role;
grant execute on function public.responses_missing_webhook_delivery(integer) to service_role;
grant execute on function public.responses_due_abandoned_event(integer) to service_role;
