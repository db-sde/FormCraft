-- Security checklist (26 Oct 2026).

-- 1. Secrets aren't readable by workspace members.
-- Every member could read every column of these tables through the API
-- (row-level security decides which rows, not which columns): a viewer
-- could fetch a webhook's signing secret and forge deliveries to its
-- receiver. Only the server (service role) reads secrets now. Members
-- still see everything else, and integration managers can still set a
-- new secret (UPDATE is unchanged).
revoke select on public.webhook_endpoints from authenticated;
grant select (id, form_id, url, enabled, created_at, updated_at, kind, config, api_key_id)
  on public.webhook_endpoints to authenticated;

revoke select on public.sheets_connections from authenticated;
grant select (id, workspace_id, form_id, spreadsheet_id, enabled, created_at, updated_at)
  on public.sheets_connections to authenticated;

-- 2. Theme images and fonts are only images and fonts.
-- Editors upload logos and backgrounds straight to this public bucket;
-- the builder only offers images, but the storage API took any type, so
-- an HTML page (or a script-carrying SVG) could be hosted at a public
-- URL. Storage now refuses anything else, and anything large.
update storage.buckets
set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'font/woff2'],
    file_size_limit = 5242880 -- 5 MB
where id = 'theme-assets';

-- Respondent uploads are type-checked by the server already; the bucket
-- refuses anything else too (pdf + the image types the sniffer knows).
update storage.buckets
set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'],
    file_size_limit = 104857600 -- 100 MB, the largest a question allows
where id = 'response-uploads';
