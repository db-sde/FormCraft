# Testing

Three layers, each with a distinct job. Don't weaken a test to make it
pass — if a test is wrong, fix the test deliberately and say so in the
commit message.

## Unit (Vitest) — `tests/unit`, colocated `*.test.ts` allowed too

Pure logic, no network/DB:

- Form schema validation (structural + semantic + publication compile)
- Logic engine evaluation (operators, jump resolution, cycle
  detection)
- Response state-machine transition helpers
- Idempotency-key / revision comparison helpers
- Analytics calculations (completion rate, preview filtering)
- CSV serialization (escaping, formula-injection guarding)

Run: `npm run test` / `npm run test:watch`.

## Integration (Vitest against a local Supabase instance)

- RLS: user A cannot read/write user B's workspace data via direct
  Postgres queries under A's JWT.
- Workspace membership/role enforcement at the query layer.
- Versioning: draft edits never mutate published rows; publish creates
  a new immutable version; unique-draft-per-form constraint holds.
- Response state machine: DB trigger rejects `completed → partial`.
- CAS/revision: a write with `clientRevision` <= stored value is
  rejected.
- Webhook delivery record lifecycle (pending → succeeded/failed/
  exhausted) and retry scheduling.

Requires `supabase start` locally (documented in `README.md`). Run:
`npm run test:integration`.

## E2E (Playwright) — `tests/e2e`

Critical journeys, one spec file per journey group. Status as of this
writing:

1. Signup → email verification handling → login — **done**
   (`auth.spec.ts`; signup only through the "check your email" step,
   not actual inbox confirmation — see file comment)
2. Dashboard empty state → create form — **done** (`form-builder.spec.ts`)
3. Add/edit/reorder/delete questions, keyboard reorder alternative —
   **partial** (`form-builder.spec.ts` covers add/edit/delete; keyboard
   reorder not yet covered)
4. Configure validation, configure logic, configure multiple endings —
   not yet covered
5. Theme the form; preview desktop + mobile — not yet covered
6. Publish → open public URL → complete form (happy path) — **done**
   (`publish-and-respond.spec.ts`, a genuinely separate browser
   context for the respondent side)
7. Partial response: start, autosave, refresh, resume, finish —
   **done** (`partial-response-resume.spec.ts`)
8. Duplicate submit protection (retry the complete call) — **done**
   (`duplicate-submit.spec.ts`, driven at the HTTP layer — see file
   comment for why)
9. Response dashboard: table, detail view, delete with confirmation —
   not yet covered as a dedicated spec (exercised incidentally by
   `publish-and-respond.spec.ts`'s final assertion)
10. CSV export — not yet covered
11. Notification email triggered (asserted via test inbox/mock) — not
    yet covered (local Supabase's Inbucket/Mailpit could back this)
12. Webhook delivery (asserted against a local test receiver) — not
    yet covered
13. Analytics numbers update, preview traffic excluded — not yet
    covered
14. Template → independent editable copy, original template untouched
    — **done** (`templates.spec.ts`)
15. Forgot password → emailed link → set new password → log in with it
    — **done** (`password-reset.spec.ts`, following the real link from
    local Supabase's mail catcher; also covers the invalid-link notice)

16. Lead capture: a respondent who fills the contact step and leaves
    before the last question appears under Leads ("Didn't finish") and
    Responses → Incomplete — **done** (`lead-capture.spec.ts`; the
    completed path is in `publish-and-respond.spec.ts`)
17. Autosave under slow network never restarts the form — **done**
    (`autosave-race.spec.ts`; the old code fails it with an emptied
    field)

18. Opening a form isn't a start; the first interaction is, with its
    UTM campaign — **done** (`form-starts.spec.ts`)
19. Form settings: saving unfinished answers off stores nothing before
    submit (and hides the respondent notice); renaming the public link
    moves the form — **done** (`form-settings.spec.ts`)

Integration: shared rate limit (`rate-limit.test.ts`), account deletion
(`account-deletion.test.ts`), partial-status rule, drop-off and
retention (`responses.test.ts`). E2E runs clear the persistent
rate-limit table first (`tests/e2e/global-setup.ts`).

CSV export past PostgREST's 1000-row cap is covered at the
integration level (`tests/integration/csv-export.test.ts`) rather than
E2E, since it needs 1000+ seeded responses.

`tests/e2e/helpers.ts` creates real, already-confirmed users via the
GoTrue admin API (never a hand-crafted `auth.users` row — see its own
comment for why that silently breaks login) and cleans up every
workspace it creates before deleting the user (`workspaces.owner_id`
is `on delete restrict`, deliberately). Found and fixed two real bugs
while writing and running this suite for the first time — see
DECISIONS.md: the `/signup/check-email` and
`/forgot-password/check-email` pages were unreachable for an
already-authenticated visitor (a middleware prefix-match bug), and
`forms.slug` was only unique per-workspace while the public runtime
looks a form up by slug alone (fixed in migration 00000000000012).

Run: `npm run e2e` (headless), `npm run e2e:ui` for the Playwright UI.
Requires `supabase start` running locally (same as integration tests).

## Security tests

Cross-cutting, live alongside integration + E2E depending on the
layer being attacked: cross-user/cross-workspace access via forged
IDs, malicious/malformed schemas, manipulated required/logic payloads,
replay of old idempotency keys, stale/out-of-order autosave writes,
XSS payloads in every free-text field (label, option text, theme
strings), CSRF on state-changing routes, malicious file upload
(wrong-content-for-extension, oversized, disallowed type), public
endpoint flooding against the rate limiter.

## Documented export bound

CSV export is synchronous up to **10,000 responses**. Above that, the
endpoint returns `400 export_too_large` with guidance rather than
truncating silently. (Recorded here and in `DECISIONS.md` once picked
— this is the Phase 1 default; revisit if real usage proves it wrong.)

## CI gate

`.github/workflows/ci.yml` has two jobs, on every PR:

- `build-and-test`: install → lint → typecheck → format check → unit
  tests → build.
- `integration-and-e2e`: install → `supabase start` (via
  `supabase/setup-cli`, applying every migration) → export its
  connection details into the app's actual env var names (the CLI's
  own names don't match — see the workflow's inline comment) →
  integration tests → Playwright browser install → the full E2E suite
  (Playwright's own `webServer` builds and starts the app). On
  failure, uploads the Playwright HTML report as a build artifact.

The `integration-and-e2e` job's individual pieces (the CLI's env
export/override-name mapping, `npm run test:integration`, the full E2E
suite) were each verified locally; the job has not yet been observed
running inside an actual GitHub Actions runner, since this environment
has no way to trigger one — worth confirming on the first real PR.
