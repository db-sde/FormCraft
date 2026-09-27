-- Storage buckets: respondent file uploads stay private; theme assets
-- (logo, background) are public since they're rendered on the public
-- form runtime and carry no sensitive data.

insert into storage.buckets (id, name, public)
values ('response-uploads', 'response-uploads', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('theme-assets', 'theme-assets', true)
on conflict (id) do nothing;

-- response-uploads: no public/anon policies at all. All access goes
-- through service-role-backed route handlers (upload + signed-URL
-- issuance for the creator dashboard), matching the "public respondents
-- never hold a session" posture used for the responses/answers tables.
create policy "response-uploads: members can read via response ownership"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'response-uploads'
    and exists (
      select 1
      from public.uploads u
      join public.responses r on r.id = u.response_id
      join public.forms f on f.id = r.form_id
      where u.storage_path = storage.objects.name
        and public.is_workspace_member(f.workspace_id)
    )
  );

-- theme-assets: workspace members can manage their own form's assets;
-- path convention is `<workspace_id>/<form_id>/<filename>`.
create policy "theme-assets: members can manage own workspace assets"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'theme-assets'
    and public.is_workspace_member((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'theme-assets'
    and public.is_workspace_member((storage.foldername(name))[1]::uuid)
  );

create policy "theme-assets: public can read"
  on storage.objects for select
  to anon
  using (bucket_id = 'theme-assets');
