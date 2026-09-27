# Decisions

Record of choices made where the Phase 1 spec was ambiguous or left an
implementation detail open. Newest first.

## 2026-09-27 — `proxy.ts` instead of `middleware.ts`

Next 16 deprecated the `middleware.ts` file convention in favor of
`proxy.ts` (same behavior, renamed export: `proxy` instead of
`middleware`). Followed the framework's own migration guidance rather
than keeping the deprecated name, since this is a from-scratch project
with no reason to carry deprecated conventions forward.

## 2026-09-27 — Explicit Data-API grants required (RLS alone is not enough)

This Supabase version does not auto-expose newly created tables to the
`anon`/`authenticated` Postgres roles by default (see the
`auto_expose_new_tables` note in `supabase/config.toml` — this is the
new default across Supabase, not a local-only quirk). RLS policies
only take effect once the calling role already has the underlying SQL
`GRANT`; without it, every query fails with `42501 permission denied
for table X`, which looks like an RLS failure but isn't one. Added
migration `00000000000007_grants.sql` with explicit `GRANT`s that
mirror exactly what each table's RLS policies already allow — this is
not a widening of access, just making the schema reachable at all.
Discovered by testing the real signup → workspace-creation flow live
against local Postgres, not by inspection.

## 2026-09-27 — `workspaces` SELECT policy allows the owner directly

Postgres requires the row(s) produced by `INSERT ... RETURNING` to
also satisfy the table's SELECT RLS policies — not just the INSERT
`WITH CHECK`. The `create_workspace_with_owner` RPC inserts the
workspace and returns it (`returning * into new_workspace`) *before*
inserting the corresponding `workspace_members` owner row in the same
function, so at the moment of the RETURNING check,
`is_workspace_member(id)` was still false and the whole insert failed
with a generic "new row violates row-level security policy" error.
Fixed by widening the `workspaces` SELECT policy to `owner_id =
auth.uid() OR is_workspace_member(id)` (migration 1) — the owner
should always be able to see their own workspace regardless of the
membership row's existence, so this isn't a security loosening, just
closing a real temporal gap. Confirmed via a minimal `psql` repro
(`set role authenticated; set request.jwt.claims = '...'; insert ...
returning *;`) before and after the fix, and via a live browser
end-to-end test. Worth remembering for any future `insert ...
returning` RPC that runs before its own supporting rows exist.

## 2026-09-27 — Next.js version

Scaffolded with whatever `create-next-app@latest` resolved to (Next
16.3.6 at bootstrap time) rather than pinning to an older LTS. Reason:
spec says "modern Next.js App Router"; no requirement to pin. Risk:
less training-data familiarity with 16-specific API changes — mitigated
by checking `node_modules/next/dist/docs` for the exact installed
version instead of relying on memory, and preferring well-established
App Router patterns (server components, route handlers, server
actions) that have been stable across 14/15/16.

## 2026-09-27 — shadcn `<Form>` wrapper unavailable

The current shadcn CLI (Radix base, Nova preset) does not ship a
`form.tsx` registry item for the Radix base library. Forms are built
directly with `react-hook-form` + `@hookform/resolvers/zod`, using the
plain `Label`/`Input`/etc. primitives, instead of the classic shadcn
`<Form>`/`<FormField>` wrapper. No product behavior is affected; this
is purely a component-composition detail.

## 2026-09-27 — Package name

npm rejects capitalized/space-containing package names, and the
working directory is `Form Builder Saas claude`. The Next.js app is
scaffolded with `package.json` name `formcraft` (also used as the
working product name in docs/UI) while the directory itself is left
unchanged. No functional impact — the directory name is never read by
the app.

<!-- Add new decisions above this line, newest first. -->
