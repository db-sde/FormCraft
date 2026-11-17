-- Google Drive (feature 50, 2026-11-14): a form can link to Drive like
-- the other business apps; each completed response's uploaded files are
-- copied there by the connector queue (one job per response and link,
-- retried with backoff, never touching the response itself).
alter table public.connector_links drop constraint connector_links_provider_check;
alter table public.connector_links
  add constraint connector_links_provider_check
  check (provider in (
    'airtable', 'salesforce', 'notion', 'mailchimp', 'zoho_crm', 'pipedrive', 'google_drive'
  ));
