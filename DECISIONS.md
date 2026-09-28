# Decisions

Record of choices made where the Phase 1 spec was ambiguous or left an
implementation detail open. Newest first.

## 2026-09-28 — Webhook retry sweep needs an external scheduler

There's no long-running worker process in this deployment model (a
modular monolith on Next.js route handlers), so "bounded exponential
retry" for webhook deliveries can't be a setInterval-style background
loop. Split it in two: the first attempt happens immediately, inline
in the `/complete` request's `after()` callback (covers the common
case — most endpoints are just up); a separate
`POST /api/cron/webhooks/dispatch`, protected by a `CRON_SECRET`
bearer token (never a user session — it fans out real HTTP requests to
creator-configured URLs, so an anonymous trigger would be a real abuse
vector), picks up anything still due later. This requires an external
scheduler (Vercel Cron, `pg_cron`, or any `curl`-on-a-timer) to be
configured at deploy time — documented in the route's own comment and
here rather than assumed. Verified locally by hand: pointed an
endpoint at a genuinely unreachable port, confirmed the first attempt
failed and was recorded with `next_attempt_at` ~1 minute out, forced
it due, and confirmed a direct call to the cron endpoint picked it up
and incremented the attempt count — the sweep does what it's supposed
to, independent of whatever ends up triggering it in production.

## 2026-09-28 — Notifications: owner-only, opt-out, `after()` not fire-and-forget

Three narrower-than-spec choices for Phase 1 email notifications:
owner-only (not every workspace member — simplest useful default,
revisit if multi-member workspaces become real); opt-out via
`notification_settings` (no row = enabled) rather than opt-in, since a
creator who just published a form almost certainly wants to know when
it gets filled out; and the send is scheduled with Next.js's `after()`
rather than a bare unawaited promise. The latter isn't stylistic — a
plain `void someAsyncCall()` in a route handler can be killed by the
serverless runtime the instant the response is flushed, silently
dropping the notification. `after()` is the documented way to keep the
function alive for exactly this "do it after responding" case. Either
way, a notification failure is swallowed internally
(`notifyFormOwnerOfCompletedResponse` never throws) — it must not be
able to affect the respondent-facing result, matching how every other
integration is treated (ARCHITECTURE.md).

## 2026-09-28 — CSV export column set comes from the latest form_version

`buildResponsesCsv` needs one stable set of columns across potentially
many responses that were each submitted against a different historical
`form_version` (a form can be edited and republished many times).
Chose the most-recently-created version's questions as the reference
column set — the closest available proxy for "current" — while still
resolving each response's own cells against _that response's own_
schema (matched by stable question id), so option labels stay correct
even if a question's options changed after that response was
submitted, and a question added later is simply blank for older
responses rather than misattributed to the wrong one.

## 2026-09-28 — `service_role` also needs explicit grants

Same root cause as the `authenticated`/`anon` grants bug from an
earlier milestone, discovered the same way (live testing, not
inspection): this Supabase version doesn't auto-grant table privileges
to _any_ Data API role, including `service_role`. The public response
API route handlers use the service-role admin client precisely because
respondents never hold a session — but bypassing RLS (what
`service_role` does) turned out to be a separate mechanism from having
the underlying SQL privilege at all, and without it every admin-client
query failed with "permission denied for table X". Migration 10 grants
`service_role` full privileges on all current tables/sequences/
functions, plus `alter default privileges` so the same bug can't recur
silently when future migrations add tables.

## 2026-09-28 — Resume doesn't restore Back-navigation history

`PublicFormRuntime` persists `answers` and the current `lastQuestionId`
to localStorage so a refresh resumes at the right question, but not
the in-memory `history` stack `FormRuntime` uses for its Back button
(that would require `FormRuntime` to report history changes through a
new callback too, for a small UX benefit). Accepted as a Phase 1 gap:
after a resume, Back is unavailable until the respondent navigates
forward again in that session. Correctness (resuming at the right
question, with the right answers, not double-submitting) is unaffected
— this is purely a "how far back can you undo" limitation.

## 2026-09-28 — Builder route moved to its own route group

`/forms/[id]` (the builder) started as a child of the `(dashboard)`
route group, so it inherited the dashboard's header/nav layout. The
builder needs a full-screen, chrome-less layout (its own top bar with
save status, question list sidebar, etc.), which a nested layout
cannot opt out of in the App Router — a child route always wraps
inside every ancestor layout. Moved the route to its own `(builder)`
route group, a sibling of `(dashboard)`. Route groups don't affect the
URL (`/forms/[id]` is unchanged), and the proxy's protected-route
matching is path-based (`/forms`, `/dashboard` prefixes), so this was
a pure file-organization change with no behavioral impact on auth or
routing — confirmed by re-running the full build and the live browser
test after the move.

## 2026-09-28 — Row-action buttons must stay in the tab order

The builder's question-list row actions (move up/down, duplicate,
delete) were built with Tailwind's common `hidden group-hover:flex`
pattern to only show them on hover. Testing the actual keyboard path
(not just visually checking hover) showed this was a real
accessibility bug, not just a style choice: `display: none` removes an
element from the tab order entirely, so a keyboard-only user could
never reach these controls at all — including the reorder buttons that
are supposed to be **the** keyboard alternative to drag-and-drop
required by the spec. An element that's `hidden` can't receive focus,
so a `has-[:focus-visible]:flex` fallback intended to reveal it on
focus never fires either (nothing can focus it to trigger that
selector). Fixed by keeping the buttons always in the DOM/tab order
and toggling `opacity-0` → `opacity-100` on hover _or_ focus-within
instead of `display`. Verified via `read_page` (which lists the full
accessibility tree regardless of visual state) that all row-action
buttons are present with correct labels, and via a live click on a
ref-addressed button that reordering actually works.

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
workspace and returns it (`returning * into new_workspace`) _before_
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
