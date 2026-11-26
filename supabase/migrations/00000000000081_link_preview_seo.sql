-- Link preview and SEO to the developer spec (26 Nov 2026, item 1).
--
-- * `forms.seo` is what the creator is editing; `forms.seo_live` is what
--   the public page uses, copied on publish like other live edits, with
--   the share card made at publish time.
-- * Share images, icons and cards live in a public, CDN-cached bucket that
--   only the server writes to: uploads are re-encoded there first, so
--   EXIF and location data never reach it.
-- * The sitemap lists only forms whose indexing is on, live, not archived,
--   not password-protected and on a plan with custom SEO.

alter table public.forms
  add column seo_live jsonb not null default '{}'::jsonb
    check (jsonb_typeof(seo_live) = 'object' and pg_column_size(seo_live) <= 4096);

-- What's set today stays live (it went live immediately before this).
update public.forms f set seo_live = f.seo
 where f.seo <> '{}'::jsonb
   and exists (select 1 from public.form_versions v
                where v.form_id = f.id and v.status = 'published');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('share-assets', 'share-assets', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon'])
on conflict (id) do nothing;
-- No policies for signed-in users: only the server (service role) writes,
-- after checking the member and the plan. Reads are public by URL.

/** Forms that may be listed in sitemap.xml: indexing on, live, not
 * archived or protected, and the workspace's plan includes custom SEO
 * (an override wins over the plan). With the verified custom domain the
 * form is served on, if any. */
create function public.sitemap_forms()
returns table (slug text, hostname text, is_default boolean, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select f.slug,
         d.hostname,
         coalesce(d.default_form_id = f.id, false),
         f.updated_at
    from public.forms f
    join public.workspaces w on w.id = f.workspace_id
    join public.plans p on p.id = w.plan_id
    left join lateral (
      select cd.hostname, cd.default_form_id
        from public.custom_domains cd
       where cd.workspace_id = f.workspace_id and cd.status = 'verified'
       order by (cd.default_form_id = f.id) desc nulls last, cd.created_at
       limit 1) d on true
   where f.deleted_at is null
     and f.archived_at is null
     and w.status <> 'suspended'
     and (f.seo_live ->> 'indexing') = 'true'
     and coalesce((w.entitlement_overrides ->> 'custom_seo')::boolean,
                  (p.entitlements ->> 'custom_seo')::boolean, false)
     and exists (select 1 from public.form_versions v
                  where v.form_id = f.id and v.status = 'published')
     and not exists (select 1 from public.form_access_secrets s where s.form_id = f.id)
     and (f.closes_at is null or f.closes_at > now())
   order by f.updated_at desc
   limit 5000;
$$;
revoke all on function public.sitemap_forms() from public;
grant execute on function public.sitemap_forms() to anon, authenticated, service_role;
