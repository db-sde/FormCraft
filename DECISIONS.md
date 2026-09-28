# Decisions

Record of choices made where the Phase 1 spec was ambiguous or left an
implementation detail open. Newest first.

## 2026-09-28 — Autosave/complete now filter answers against the real schema, not just Zod's shape check

Adversarial testing (live curl against the running app, part of this
session's security pass) found that `saveResponseAnswers` and
`completeResponse` both wrote whatever `question_id` keys a client
sent straight into the `answers` table, with zero check against the
form's actual published schema. Zod's `z.record(z.string(),
z.unknown())` on the request body validates *shape* (it's an object of
string keys to arbitrary values) but says nothing about whether those
keys are real — shape validation and schema validation are different
questions, and only the first was being asked. This is a direct
instance of CLAUDE.md rule 1 ("never trust client-supplied ...
schema") — the client fully controls which keys appear in `answers`,
and nothing about that object's shape rules out a forged key.

Impact was contained (garbage keys are invisible to the creator — the
dashboard/CSV export only look up known question ids from the schema,
never iterate the raw `answers` table) but real: unbounded storage
growth tied to the public, rate-limited-but-not-schema-bounded
autosave endpoint (up to 120 requests/10min, each able to define
arbitrarily many distinct garbage keys within the 200KB body cap).

Fixed with one new function, `filterAnswersToKnownQuestions`
(`src/domains/responses/queries.ts`), applied before every write in
both functions — `completeResponse` already had the compiled schema
in scope (no new query), `saveResponseAnswers` needed one extra
indexed lookup (`form_versions` by the response's own
`form_version_id`, already selected for free from the CAS update) to
get it. Chose to silently drop unknown keys rather than reject the
whole request: a legitimate respondent's request always consists
entirely of real keys, so a mix only ever happens from a forged
request, and there's no useful error to surface to an attacker anyway
— silently ignoring is simpler than adding a new "some of your answer
keys were invalid" error path nothing legitimate would ever trigger.

## 2026-09-28 — The builder's editing surface is desktop-oriented by design; respondent/dashboard pages are fully responsive

The spec calls for "responsive design," which could be read as every
screen in the product working at any width. Walking the app at a real
375px viewport this session found and fixed two genuine bugs (a
dashboard header that ran text together illegibly, a builder toolbar
that overlapped its own back button — both above), but it also
surfaced a bigger, more deliberate question: the builder's 3-pane
layout (question list + center canvas + a right settings panel, each
needing real width to be usable — dragging questions, editing option
lists, previewing theme colors) doesn't fit 375px without either
hiding two of the three panes behind navigation or shrinking each pane
to the point of being unusable for actual editing work.

Chose not to redesign it into a mobile-first editing experience.
Every comparable tool (Google Forms, Typeform, Notion, Figma) makes
the identical split: the *creation* surface is desktop-oriented, while
the *consumption*/*respondent* surface is mobile-first — because
editing a multi-panel document is fundamentally a different task than
filling one out, and forcing the former into a phone-sized viewport
produces a worse tool without actually serving the "someone fills this
out on their phone" need, which the public runtime already serves
fully (verified separately at 375px, no changes needed). Applied the
same reasoning to every other creator page (dashboard, responses,
integrations, templates), which all needed to and do work at mobile
width, since checking results or connecting a webhook doesn't need
three panes of real estate the way question editing does. The dividing
line is task-shaped, not "creator vs. respondent" — it's specifically
the dense multi-panel editing canvas that's scoped out.

## 2026-09-28 — Every integration test bypassed RLS, which is how a real RLS bug shipped

Found while live-testing the accessibility/mobile-polish pass (not by
code review): a signed-in visitor got a false 404 on every public form
link at `/f/[slug]`. Root cause was `alter policy ... to anon` on the
two SELECT policies backing that route — Postgres RLS applies a policy
only to the exact role(s) it names, so a logged-in session (querying
as `authenticated`, not `anon`) matched nothing and the page correctly
called `notFound()` on a form that very much exists. Fixed in migration
`00000000000011_public_form_read_for_authenticated.sql`
(`to anon, authenticated`).

The more important finding is *why* this shipped past a test suite
with 100+ integration tests: every single one of them uses the
service-role client, which bypasses RLS entirely by design (it's how
route handlers run privileged work). That's the right client for
testing domain logic, but it means RLS itself — arguably the single
most security-critical layer in this app (see CLAUDE.md rule 4) — had
zero direct test coverage. This is the same root-cause *class* as this
session's earlier grants bugs (`authenticated`/`service_role` lacking
table grants on new tables): a gap between "the service-role tests
pass" and "a real user's session actually works," caught both times
only by manually driving the app as a real user rather than by the
automated suite. `tests/integration/public-form-access.test.ts` closes
this specific gap by signing in through the anon-key client (the same
one `createServerSupabaseClient()` constructs) and asserting on what a
real, unrelated authenticated user can and can't read — not a general
fix for the class of bug, but a concrete data point future work in
this area should follow: prefer the anon/authenticated client over the
service-role client whenever a test is really asking "does RLS let the
right people in and keep the wrong people out," not "does the domain
function work."

## 2026-09-28 — Google Sheets: built and verified everything except the OAuth client itself

This environment has no real Google Cloud project, so the actual
`accounts.google.com` consent flow and the real `sheets.googleapis.com`
API can't be exercised end-to-end here — the spec's "don't ship
unverified code" bar could have meant leaving all of Sheets undone
until deploy time. Rejected that as too conservative: everything on
this app's side of the OAuth boundary — token encryption, the
refresh/expiry logic, the sync-enqueue/dispatch/backoff engine, the
connect/disconnect UI, and both OAuth routes — is ordinary code this
environment absolutely can build and verify, and is exactly the part
most likely to have real bugs (token expiry math, encryption
round-tripping, retry scheduling). So `oauth.ts`'s
`exchangeCodeForTokens`/`refreshAccessToken` and `append.ts`'s
`appendRowToSheet` all take an optional endpoint/base-URL override,
letting `tests/integration/sheets.test.ts` spin up a tiny local
`node:http` server that stands in for both of Google's endpoints —
the same "real local receiver, not a mock" rigor the webhooks
milestone used, extended to a domain where the real counterpart isn't
reachable at all. That test proves a genuine token-refresh-then-append
cycle, not just that the code compiles.

The one thing that *can't* be faked is Google's own `accounts.google.com`
actually accepting a client id — so as a one-time manual check (not
part of the automated suite, since it needs credentials this repo
doesn't have and shouldn't), `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET` were
set to placeholder values and the "Connect Google Sheets" button was
clicked in a real browser. It correctly reached the real Google
endpoint with the right scope/state/params and failed only with
`Error 401: invalid_client` — confirming the code is right up to
exactly the boundary that requires a real registered OAuth client,
which is documented in PROJECT_STATUS.md as the one remaining
deploy-time step, not a code gap.

Token encryption reuses AES-256-GCM keyed off `APP_SECRET` (already
this app's one server-only secret) rather than introducing a second
secret to manage. The sync retry/backoff engine
(`dispatchDueSheetsSyncs`) deliberately imports
`nextBackoffDelayMs`/`isExhausted` from `@/domains/webhooks/backoff`
instead of re-implementing the same bounded schedule a second time —
it's generic over "attempt count → delay," not actually
webhook-specific, and Sheets syncs should back off exactly the same
way webhook deliveries do.

## 2026-09-28 — Templates are seeded via a script that reuses the builder's own schema helpers, not hand-written JSON

A template is just a `FormSchemaV1` sitting in the `templates` table,
and the tempting shortcut was to hand-write 24 JSON blobs directly in
a SQL migration. Rejected that: hand-written JSON has no type checking
and no relationship to the real validation pipeline, so a typo in a
settings field (e.g. `rating.scale` outside the `5 | 10` union) would
only surface the first time a creator tried to load that template in
the builder — exactly the kind of "shipped unverified" the spec's
quality bar rules out. Instead `scripts/seed-templates.ts` builds each
template with the same `createQuestion`/`createOption`/`createEnding`
helpers `src/domains/forms/builder.ts` already exports for the builder
UI itself, then runs every one through the real
`parseFormSchema`/`validateSemantics` pipeline before writing anything
— a broken template fails the seed script, not a creator's first
click. `getTemplateById` re-parses on every read for the same reason
(belt-and-braces against a template ever being hand-edited directly in
the DB into something invalid).

The seed script is idempotent (upserts by title) and lives outside the
migrations directory on purpose: template *content* (copy, question
choices) is product decisions that will keep changing, unlike schema
*structure*, which migrations own. Re-running the script after editing
a template in the script is the intended workflow, not a one-time
bootstrap.

## 2026-09-28 — Analytics events fire server-side, never from client JS

`form_viewed`/`form_started`/`form_submitted` could have been tracked
with `posthog-js` in the browser, but that means the funnel is only as
reliable as whichever respondents have JS enabled and no ad/tracker
blocker — exactly the population most likely to differ systematically
from the rest, which would make `computeCompletionRate` quietly wrong
in a way nobody could detect from the number alone. Instead all three
events fire from server code that was already going to run regardless
of client JS: `form_viewed` from `/f/[slug]`'s server component
(reached on every request, full stop), `form_started` from
`/api/responses/start` (a response row is never created any other
way), `form_submitted` from `/api/responses/[id]/complete` (same
`after()` callback as the existing notification/webhook work). This
also means `computeFunnelSummary`'s three counts are always internally
consistent with each other and with the response rows themselves,
since they're derived from the same server-side lifecycle instead of
two independently-flaky signals (client beacon vs. server DB write)
that could drift apart under packet loss, a slow client, or a
respondent closing the tab early.

One consequence: `recordAnalyticsEvent` (the Postgres write — the
dashboard's source of truth) deliberately has no `"server-only"`
import, unlike the rest of this codebase's side-effect modules
(`notifications/send.ts`, `lib/analytics/posthog-server.ts`), because
`"server-only"`'s marker throws on *any* import outside Next's
`react-server` bundler condition — including a plain Vitest run — so a
file that needs one would be unable to be integration-tested directly
the way `webhooks/queries.ts` and `responses/queries.ts` already are.
PostHog capture stays in its own `"server-only"`-marked, deliberately
untested wrapper (`captureServerEvent`), called as a second, separate
step at each of the three call sites rather than folded into
`recordAnalyticsEvent` itself.

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
