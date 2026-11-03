-- Hardening (2026-11-03): choose which sites may embed a form.
--
-- Published forms can be framed by any site (Share → Embed), which also
-- lets a hostile page frame one — including its payment step — under
-- its own content (clickjacking). With embed_origins set, the form's
-- Content-Security-Policy allows framing only by those origins
-- (frame-ancestors). Null keeps today's "any site".

create function public.valid_embed_origins(p_origins text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_origins is null or (
    cardinality(p_origins) <= 20
    and not exists (
      select 1 from unnest(p_origins) o
      where o !~ '^https?://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$'
    )
  );
$$;

alter table public.forms add column embed_origins text[]
  check (public.valid_embed_origins(embed_origins));

-- Read by the request proxy before anyone is signed in: a published
-- form's allowed embedders, nothing else.
create function public.form_embed_origins(p_slug text)
returns text[]
language sql
security definer
stable
set search_path = ''
as $$
  select f.embed_origins from public.forms f
  where f.slug = p_slug and f.deleted_at is null
  limit 1;
$$;
revoke all on function public.form_embed_origins(text) from public;
grant execute on function public.form_embed_origins(text) to anon, authenticated, service_role;
