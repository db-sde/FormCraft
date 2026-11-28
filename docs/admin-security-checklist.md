# Staff portal security checklist

What protects the Super Admin portal, how it is done, and what proves it.
Organised by the OWASP ASVS 4.0 chapters at Level 2, for the admin surface
only (the customer app is covered by `docs/testing.md` and the hardening
review in `DECISIONS.md`). Last checked 25 November 2026.

Status: **Done** (built and tested), **Needs you** (a setting or decision
outside the code), **Accepted** (a known limit, with the reason).

Use it before launch and after any change to the portal. An external
penetration test is still recommended before the portal holds real staff
(see the end).

## V1 Architecture

| Control                                                        | How                                                                                                                                                     | Evidence                                                                                              | Status                                                                                                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The admin surface is separate from the customer app            | Same repository, separate Vercel project with `ADMIN_SURFACE=1`. Elsewhere `/admin` is a 404, and the admin build serves nothing else (`src/proxy.ts`). | `admin.spec.ts` "the customer app has no admin portal"; live check: `/admin` 404 on the customer site | Done (code); **For now** served at `/admin` on the app (`ADMIN_SURFACE=shared`, DECISIONS.md 28 Nov). **Needs you**: create the admin project and domain |
| Authorisation lives in the database, not in pages or the proxy | Every read and write is an `admin_*` function that starts with `private.check_staff()`. Pages only redirect.                                            | `admin-functions-gated.test.ts` fails the build if any `admin_*` function skips the check             | Done                                                                                                                                                     |
| Admin data unreachable through the API                         | Tables in schema `private`, no grants to `anon` or `authenticated`                                                                                      | `admin-functions-gated.test.ts` ("nothing in the private schema is granted")                          | Done                                                                                                                                                     |
| No service-role key in the portal                              | The portal calls with the staff member's own token (`adminCall`). Only cron routes use the secret key.                                                  | `admin-client-allowlist.ts` lists every file allowed the secret key                                   | Done                                                                                                                                                     |

## V2 Authentication

| Control                                     | How                                                                                                                                          | Evidence                                                                                         | Status                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| A second factor for everyone, every session | `check_staff` refuses anything below `aal2`. The portal sends staff to authenticator set-up first.                                           | `staff-foundation.test.ts` ("refuses everyone without a second factor"); `admin.spec.ts` sign-in | Done                                                                        |
| Fresh code for high-risk actions            | Step-up: a code entered in the last 10 minutes, required for approvals, applying changes, exports, erasure, pausing AI and the access review | `hardening-phase5.test.ts` (a code over 10 minutes old, or a password alone, is refused)         | Done                                                                        |
| Sign-in throttling                          | 20 attempts an hour per address and 8 per email; 10 code attempts per 10 minutes per account and 30 per address                              | `src/app/admin/actions.ts`                                                                       | Done; **Needs you**: a Vercel WAF rate-limit rule on `/admin/login` as well |
| Staff accounts can't be customer accounts   | A trigger refuses staff in workspaces, and adding a customer account as staff fails                                                          | `staff-foundation.test.ts`                                                                       | Done                                                                        |
| Sign-in from an unexpected place is noticed | A new address for someone with history raises an alert that owners are emailed (migration 76)                                                | `hardening-phase5.test.ts`                                                                       | Done                                                                        |
| Network restriction                         | Allow only office or VPN addresses on the admin project                                                                                      | —                                                                                                | **Needs you**: the IP list (Vercel firewall custom rule)                    |
| No shared or bootstrap backdoors            | The first owner is created once from the command line with the secret key. The database refuses it once any staff exist.                     | `staff-foundation.test.ts`                                                                       | Done                                                                        |

## V3 Sessions

| Control                                                  | How                                                                                             | Evidence                                                      | Status |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------ |
| Idle timeout 30 minutes, absolute 12 hours               | Checked in the database on every call (`staff_session_activity`, `auth.sessions.created_at`)    | `staff-foundation.test.ts`                                    | Done   |
| Sign-out and disabling take effect at once               | The session must still exist in `auth.sessions`. Disabling staff deletes their sessions.        | `staff-foundation.test.ts`                                    | Done   |
| Cookies: host-only, `Secure`, `SameSite=Lax`, `HttpOnly` | `sessionCookieOptions` (HttpOnly on the admin surface, because no browser client is used there) | `admin.spec.ts` checks every `sb-` cookie is HttpOnly and Lax | Done   |
| No caching of portal pages                               | `Cache-Control: no-store` on every admin response                                               | `admin.spec.ts`                                               | Done   |

## V4 Access control

| Control                                         | How                                                                                                                                                                                          | Evidence                                                     | Status |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------ |
| Least privilege by role                         | Six roles; owners can only remove permissions from someone, never add                                                                                                                        | `staff-foundation.test.ts`, `customer-operations.test.ts`    | Done   |
| Two people for high-risk changes                | Staff, plans, account status, AI settings, erasure and notices need someone else's approval. The request binds the exact change by a hash. No self-approval; requests expire after 24 hours. | Every Phase 0–4 integration file                             | Done   |
| Owner emergency path is visible                 | Every emergency approval needs a reason, is marked, and alerts owners                                                                                                                        | `operations-monitoring.test.ts`                              | Done   |
| Every high-risk change carried out tells owners | One alert per change applied (migration 76)                                                                                                                                                  | `hardening-phase5.test.ts`                                   | Done   |
| Regular access review                           | Monthly: the owner confirms each active staff member; a reminder when one is due                                                                                                             | `hardening-phase5.test.ts`, `admin.spec.ts`                  | Done   |
| Customers see staff actions                     | Status, plan and erasure changes appear in the workspace's own audit log as "FormCraft support"                                                                                              | `customer-operations.test.ts`, `privacy-and-notices.test.ts` | Done   |

## V5 Validation and injection

| Control                                 | How                                                                                                                                   | Evidence                                                                              | Status |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------ |
| No SQL injection                        | Parameterised functions, `search_path = ''`, no dynamic SQL from input. Sorting uses a fixed list (`bad_sort` otherwise).             | `operations-monitoring.test.ts` ("drop table" sort refused); `supabase db lint` in CI | Done   |
| Server-side validation of every setting | Entitlement keys and types, AI models (allowlist in code and the database), notice audiences, drill fields, https-only evidence links | `customer-operations`, `ai-gateway`, `privacy-and-notices`, `hardening-phase5` tests  | Done   |
| No customer content rendered as HTML    | The portal shows no answers or customer HTML. Email bodies are escaped.                                                               | `ops-background.test.ts` (escaping)                                                   | Done   |

## V7 Logging

| Control                                             | How                                                                                                                       | Evidence                                                                              | Status |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------ |
| Every privileged action and every refusal is logged | The audit entry is written in the same transaction as the action. Refusals are logged too.                                | `staff-foundation.test.ts`                                                            | Done   |
| Reads of personal data are logged                   | Opening a customer, searching, opening and exporting privacy requests                                                     | `customer-operations`, `privacy-and-notices` tests                                    | Done   |
| Tamper evidence                                     | Insert-only trigger and hash chain, checked every 5 minutes. The latest fingerprint is copied to the platform logs daily. | `staff-foundation.test.ts` (an edited row is caught); `operations-monitoring.test.ts` | Done   |
| No secrets, prompts or answers in logs              | AI usage stores counts only. Alerts and errors carry ids, not content.                                                    | `ai-gateway.test.ts`                                                                  | Done   |

## V8 Data protection

| Control                                          | How                                                                                                                                                                           | Evidence                                          | Status                                                                                                               |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Personal data minimised in the portal            | The 360 view shows counts and names, never answers or files                                                                                                                   | `customer-operations.test.ts`                     | Done                                                                                                                 |
| Privacy requests on time and with evidence       | 30-day deadline with alerts; identity check before export or erasure; erasure approved and evidenced                                                                          | `privacy-and-notices.test.ts`                     | Done                                                                                                                 |
| Backups and restore                              | Backup status in the portal; restore drills recorded; an alert after 90 days without one                                                                                      | `operations-monitoring`, `hardening-phase5` tests | Code done; **Needs you**: production has no backups until the Supabase plan is upgraded                              |
| Stored credentials encrypted with their own keys | AES-256-GCM, bound to their row. Keys come from `ENCRYPTION_KEYS`; without it, from `APP_SECRET`. The old key stays readable while moving, so rotating doesn't strand values. | `hardening.test.ts` (rotation and moving keys)    | Code done; **Needs you**: set `ENCRYPTION_KEYS` in production and run `npm run secrets:reencrypt` (runbook, Secrets) |

## V9 Communications

| Control                           | How                                              | Evidence                        | Status |
| --------------------------------- | ------------------------------------------------ | ------------------------------- | ------ |
| TLS everywhere, HSTS              | Vercel's TLS and HSTS. Database SSL is enforced. | Live headers                    | Done   |
| Direct database access restricted | Network restriction to one address               | `supabase network-restrictions` | Done   |

## V10 Malicious code and supply chain

| Control                                                | How                                                                                          | Evidence | Status                                                              |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------- |
| Dependency and secret scanning                         | `security.yml`: secret scan, CodeQL, dependency audit on every push                          | CI       | Done                                                                |
| Branch protection, review on migrations and admin code | Required CI on `main`; CODEOWNERS review for `supabase/migrations/**` and `src/app/admin/**` | —        | **Needs you**: GitHub settings (pushes go straight to `main` today) |
| Org-wide 2FA on GitHub, Vercel and Supabase            | Account settings                                                                             | —        | **Needs you**                                                       |

## V11 Business logic

| Control                           | How                                                                                                        | Evidence                                  | Status                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------- |
| Limits on bulk or runaway actions | At most 5 notices a day and 50 emails per run; AI daily ceiling and atomic credits; search and list limits | `privacy-and-notices`, `ai-gateway` tests | Done                                                                            |
| Per-staff rate limits on reads    | Not built: reads are logged and lists are capped                                                           | —                                         | Accepted: the audit trail and the monthly review cover misuse at this team size |

## V12 Files

| Control                       | How                                                                                               | Evidence                                                | Status |
| ----------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------ |
| The portal accepts no uploads | No file inputs. Evidence is a link (https only).                                                  | —                                                       | Done   |
| Erased files really go        | Their paths are queued and removed through the storage API, retried, and an alert raised if stuck | `privacy-and-notices.test.ts`, `ops-background.test.ts` | Done   |

## V13 API

| Control                        | How                                                                    | Evidence                               | Status |
| ------------------------------ | ---------------------------------------------------------------------- | -------------------------------------- | ------ |
| No API on the admin surface    | `/api/*` is a 404 there. Server actions keep Next's same-origin check. | `src/proxy.ts`; `api-contract.spec.ts` | Done   |
| Cron endpoints need the secret | `rejectUnlessCron` on every cron route                                 | `api-contract.spec.ts`                 | Done   |

## V14 Configuration

| Control                                                         | How                                                                                                                                    | Evidence                       | Status                                                                                         |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------- |
| Strict CSP with nonces; nothing loaded or framed from elsewhere | The admin policy allows only its own server: `connect-src 'self'`, `frame-src 'none'`, `frame-ancestors 'none'`                        | `csp.test.ts`, `admin.spec.ts` | Done                                                                                           |
| Not indexed; no framework banner                                | `X-Robots-Tag: noindex, nofollow`; `poweredByHeader: false`                                                                            | `admin.spec.ts`                | Done                                                                                           |
| Browser features off                                            | `Permissions-Policy` turns off camera, microphone, geolocation                                                                         | Live headers                   | Done                                                                                           |
| Separate secrets per surface                                    | The admin project gets its own Supabase secret key (revocable alone) and holds the management token. Preview has its own `APP_SECRET`. | —                              | **Needs you** when the admin project is created; legacy Supabase keys still to be switched off |

## Drills (Phase 5 gate)

Automated, on every CI run:

- **Webhook destination down, then back**: each event is delivered exactly
  once after backing off (`webhook-workers.test.ts`, "outage drill").
- **Email provider down while a notice is going out**: retried with the
  same idempotency key and sent once (`privacy-and-notices.test.ts`).
- **Scheduler failing**: raises a critical alert, and the alert clears once
  it recovers (`operations-monitoring.test.ts`).
- **AI provider failing**: the call is recorded as an error and the error
  reaches the action, which shows the customer a message (`ai-gateway.test.ts`).
- **Storage failing during erasure**: reported and retried
  (`ops-background.test.ts`).

By hand, recorded on Operations (owner or admin), on this schedule:

| Drill                                                    | How often                          | Runbook                                       |
| -------------------------------------------------------- | ---------------------------------- | --------------------------------------------- |
| Restore a backup into a spare project                    | Every 90 days (alerted)            | `docs/runbook.md`, Restoring data             |
| Staff lockout or compromised account                     | Every 6 months                     | `docs/runbook.md`, Staff and the admin portal |
| Secret rotation (APP_SECRET, CRON_SECRET, Supabase keys) | Yearly, and at once after any leak | `docs/runbook.md`, Secrets                    |
| Incident exercise (walk through a real-looking outage)   | Every 6 months                     | `docs/runbook.md`                             |

## Before real staff use it

1. Create the admin Vercel project and domain, its IP rule and its login
   rate-limit rule.
2. Bootstrap the first owner and add a second owner or admin, so approvals
   don't rely on the emergency path.
3. Upgrade the Supabase plan for backups, then run and record a restore
   drill.
4. Turn on branch protection and CODEOWNERS review, plus 2FA across GitHub,
   Vercel and Supabase.
5. Have an external penetration test of the admin surface (ASVS L2 scope:
   this list). Record the findings as decisions.
