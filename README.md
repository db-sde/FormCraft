# FormCraft

A Typeform-style form builder. Creators build, theme and publish
one-question-at-a-time forms; respondents fill them in anonymously,
with progress saved as they go. Creators see responses (including
unfinished ones), export CSV, and send completions to webhooks or
Google Sheets.

Built with Next.js (App Router), TypeScript, Tailwind + shadcn/ui and
Supabase (Postgres, Auth, Storage). See [`ARCHITECTURE.md`](ARCHITECTURE.md)
for how it fits together and [`DECISIONS.md`](DECISIONS.md) for why.

## Local development

Prerequisites: Node.js 20+, Docker, and the
[Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
npm install
supabase start                 # local Postgres/Auth/Storage + all migrations
cp .env.example .env.local     # then fill in the Supabase values below
npm run db:seed-templates      # optional: the template gallery
npm run dev                    # http://localhost:3000
```

`supabase status -o env` prints the local `API_URL`, `ANON_KEY` and
`SERVICE_ROLE_KEY` for `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.
Everything else in `.env.example` is optional locally — integrations
that aren't configured show a "not set up" state instead of failing.

Emails sent by local Auth (signup confirmation, password reset) are
caught by Inbucket at http://localhost:54324.

## Scripts

| Command                    | What it does                                     |
| -------------------------- | ------------------------------------------------ |
| `npm run dev`              | Dev server                                       |
| `npm run lint`             | ESLint                                           |
| `npm run typecheck`        | Route types + `tsc --noEmit`                     |
| `npm run format:check`     | Prettier check (CI runs this)                    |
| `npm run test`             | Unit tests (Vitest)                              |
| `npm run test:integration` | Integration tests against local Supabase         |
| `npm run e2e`              | Playwright E2E against a production build        |
| `npm run db:migrate`       | Push `supabase/migrations` to the linked project |
| `npm run db:types`         | Regenerate `src/lib/supabase/database.types.ts`  |

First E2E run: `npx playwright install chromium webkit`. See
[`docs/testing.md`](docs/testing.md) for what each suite covers.

## Deploying

1. Create a Supabase project and run `npm run db:migrate` against it.
2. Set every variable from `.env.example` in the host's secret store;
   `NEXT_PUBLIC_APP_URL` must be the public origin (no trailing slash).
3. In Supabase → Authentication → URL Configuration, set **Site URL**
   to that origin and add `<origin>/auth/confirm` to **Redirect URLs**.
   Signup-confirmation and password-reset links land there; if it's
   missing, Supabase silently redirects to the Site URL instead and
   the links never sign anyone in.
4. Scheduled jobs are defined in `vercel.json` (Vercel Cron sends
   `Authorization: Bearer $CRON_SECRET` automatically): webhook and
   Google Sheets retry sweeps every 5 minutes, and the daily retention
   job that deletes expired unfinished responses and old rate-limit
   rows. On other hosts, call the same `/api/cron/*` paths (GET or
   POST) with that header.
5. Set `RESEND_API_KEY` and `EMAIL_FROM` for owner notifications.

## Project map

- `src/domains/*` — business logic per domain (forms, responses,
  logic, webhooks, …); UI never bypasses these.
- `src/app` — routes: marketing, auth, dashboard, builder, the public
  respondent runtime (`/f/[slug]`) and API handlers.
- `supabase/migrations` — the only source of schema truth (with RLS).
- `docs/` — database, form schema, API and testing references.
