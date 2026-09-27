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

Critical journeys, one spec file per journey group:

1. Signup → email verification handling → login
2. Dashboard empty state → create form
3. Add/edit/reorder/delete questions, keyboard reorder alternative
4. Configure validation, configure logic, configure multiple endings
5. Theme the form; preview desktop + mobile
6. Publish → open public URL → complete form (happy path)
7. Partial response: start, autosave, refresh, resume, finish
8. Duplicate submit protection (retry the complete call)
9. Response dashboard: table, detail view, delete with confirmation
10. CSV export
11. Notification email triggered (asserted via test inbox/mock)
12. Webhook delivery (asserted against a local test receiver)
13. Analytics numbers update, preview traffic excluded
14. Template → independent editable copy, original template untouched

Run: `npm run e2e` (headless), `npm run e2e:ui` for the Playwright UI.

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

`.github/workflows/ci.yml` runs, on every PR: install → lint →
typecheck → unit tests → build. Integration/E2E run against a local
Supabase/Playwright service in CI once the DB layer exists (added in
that milestone, not at bootstrap).
