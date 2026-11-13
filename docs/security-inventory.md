# FormCraft — security inventory (first response to the 90-day plan)

**13 November 2026 (Day 0). Checked against the code on `main` at commit `3fcdebd`.**

This answers the plan's first request: each row marked **Already
implemented**, **Needs hardening** or **Missing**, then the architecture
risks, then the expected changes to the dates.

## Summary

- **Most of the product controls already exist.** Workspace separation,
  roles, private forms, data export and deletion, signed webhooks and
  scoped API keys are built and have tests.
- **The proof and the process are the weak part.** The main test run on
  GitHub has failed on every push to `main`, so the tenant-isolation and
  browser tests don't gate anything there. Pushes to `main` go straight
  to production with no review step.
- **Three things are missing outright:** the Trust Center and legal
  pages, a way to report an abusive form, and a tested backup restore.
- **Four things are built but switched off** until someone adds a key or
  a server: CAPTCHA (Turnstile), malware scanning, error tracking and
  email.
- **A secure release by Day 30–45 is realistic** if the decisions in
  "Needs your decision" arrive in the first week.

Counts: 3 rows already implemented, 8 need hardening, 1 missing.

## Inventory

| #   | Plan row (deadline)                  | Status                  | What exists today                                                                                                                                                                                                                                                                    | What's left                                                                                                                                                                                                                                                   |
| --- | ------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Initial security audit (Day 7)       | **Needs hardening**     | Architecture, database, API and compliance docs. One OWASP ZAP scan (7 Nov) and eight QA rounds, all findings fixed or answered.                                                                                                                                                     | One risk list with an owner and a severity per item. The "Risks" section below is its first draft.                                                                                                                                                            |
| 2   | Stop customer-data leaks (Day 21)    | **Needs hardening**     | Row-level security on every table. Every server path re-checks workspace membership. 13 isolation tests, 12 role tests, and tests for uploads, exports and response writes.                                                                                                          | These tests don't run on GitHub (risk 1). A route-by-route checklist showing a "user A can't reach user B" test for every API, export, upload and webhook.                                                                                                    |
| 3   | Protect accounts (Day 25)            | **Needs hardening**     | Supabase Auth sessions (1-hour tokens, rotating refresh tokens). Two-factor with an authenticator app and recovery codes, enforced in the database once switched on. Limits on login, sign-up and password reset. Reset doesn't reveal whether an account exists. Optional SAML SSO. | Two-factor is optional: nothing forces it on owners and admins. The login limit is per address and email, so changing addresses avoids it. The live Supabase Auth settings (password length, leaked-password check, email confirmation) haven't been checked. |
| 4   | Protect infrastructure/data (Day 30) | **Needs hardening**     | HTTPS and HSTS from Vercel. Encryption at rest from Supabase. Integration secrets encrypted again in the app (AES-256-GCM). No secrets in the repository; its whole history is scanned.                                                                                              | **Backups: not confirmed, and no restore has ever been tested.** A list of who has admin access to Vercel, Supabase and GitHub. The AI agent's production access (risk 3).                                                                                    |
| 5   | Automate testing (Day 30)            | **Needs hardening**     | On every push and pull request: Gitleaks (full history), `npm audit` (fails on high or critical), CodeQL. Dependabot weekly. This security run passes.                                                                                                                               | Trivy and Aikido aren't set up. The main test run is failing (risk 1). No rule stops a merge when a check fails. 10 Dependabot pull requests are open.                                                                                                        |
| 6   | Protect public forms (Day 35)        | **Needs hardening**     | Rate limits that hold when addresses change. Hidden spam trap. Uploads: real file type read from the bytes, size and type limits per question, private storage, links that open for the workspace only. Turnstile is built and checked on the server. ClamAV scanning is built.      | Turnstile is off until its keys are added. Malware scanning is off until a ClamAV server exists. **Missing:** a "Report this form" link and a takedown process.                                                                                               |
| 7   | Granular team permissions (Day 50)   | **Already implemented** | Owner, admin, editor and viewer, enforced in the database. Per-member permissions for seeing responses, exporting, publishing and managing integrations. Tests include "viewers read but change nothing".                                                                            | A written role-by-action table, and a test for any cell that lacks one.                                                                                                                                                                                       |
| 8   | Private forms (Day 55)               | **Already implemented** | Form password, close date, response limit, embed allowlist. Responses are private to the workspace by default.                                                                                                                                                                       | Nothing required. Sign-in for respondents (email or SMS code) is deferred on purpose; respondents are anonymous by design.                                                                                                                                    |
| 9   | Data controls (Day 60)               | **Already implemented** | Export to CSV, Excel and JSON. Delete a response, a form or an account. Privacy requests: find, export and erase one person's responses. Retention periods per form and per workspace, run daily. The limit on deleting from backups is written in `docs/compliance.md`.             | Publish the retention policy (part of row 11).                                                                                                                                                                                                                |
| 10  | Security activity logs (Day 65)      | **Needs hardening**     | A server-written audit log with 45 event types: exports, role and permission changes, form publishing and deletion, API keys, two-factor, SSO, privacy requests. It holds no answers. Only owners and admins can read it.                                                            | Sign-ins aren't recorded in it. The page shows the latest 50 events with no search. The log has no retention period.                                                                                                                                          |
| 11  | Trust Center + legal pages (Day 70)  | **Missing**             | No public pages. `docs/compliance.md` is accurate source material: the controls, the services data passes through, and what FormCraft does not claim.                                                                                                                                | Security overview, privacy policy, terms, DPA, acceptable use, subprocessors, a security contact, and a status or incident notice. Legal review.                                                                                                              |
| 12  | External security test (Day 90)      | **Needs hardening**     | One ZAP scan, fixed. QA rounds by an automated tester.                                                                                                                                                                                                                               | Scheduled ZAP scans. A ZeroThreat scan. A human-led penetration test and retest.                                                                                                                                                                              |

### Integrations, webhooks and payments (the plan's "review throughout" items)

| Item            | Status                  | Detail                                                                                                            |
| --------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Signed webhooks | **Already implemented** | HMAC-SHA256 over a timestamp and the body, so old deliveries can't be replayed.                                   |
| Scoped API keys | **Already implemented** | Three scopes (read forms, read responses, manage hooks). Stored as hashes, shown once, revocable.                 |
| Token rotation  | **Already implemented** | Integration secrets can be rotated, and the encryption key can be changed with a re-encrypt script.               |
| SSRF protection | **Already implemented** | Outbound URLs (webhooks, data lookups) are checked against private and internal addresses.                        |
| Payments        | **Already implemented** | Stripe Checkout and Razorpay Checkout, on the creator's own account. FormCraft never sees or stores card details. |

## Risks

Ordered by how much each one matters. Severity is my assessment.

| #   | Risk                                                                                                                                                                                                                                                                                             | Severity | Fix                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | **The main test run on GitHub is red.** All 19 recorded runs on `main` since 5 October failed. The latest stops at the "database types are up to date" step, before the integration and browser tests start. Those tests are run locally before each push, but that leaves no independent proof. | High     | Make the run green (likely a tool-version mismatch in that step), then block merges when it fails.                |
| 2   | **No review before production.** A push to `main` deploys to the live site. The plan requires a human to approve security-sensitive changes.                                                                                                                                                     | High     | Protect `main`: changes arrive as pull requests, need passing checks and one human approval.                      |
| 3   | **The AI coding agent can reach the production database.** Its command-line tool is linked to the live Supabase project, and it was used this week to republish one form. The plan forbids this.                                                                                                 | High     | Unlink it. Give the agent a separate test project. A human runs production migrations.                            |
| 4   | **Backups are unconfirmed and no restore has been tested.** Supabase's free plan takes no daily backups; the paid plan does. I couldn't see which plan the project is on.                                                                                                                        | High     | Confirm the plan, upgrade if needed, then restore a backup into a spare project and keep the evidence.            |
| 5   | **No staging environment.** There is one hosted database, and it is production. The QA tester runs against the live site.                                                                                                                                                                        | Medium   | A second Supabase project and a Vercel preview for testing.                                                       |
| 6   | **Hosting is on Vercel's free plan.** Request logs are kept for about 12 hours, which is too short to investigate an incident. That plan is also meant for non-commercial use.                                                                                                                   | Medium   | Move to the paid plan before taking paying customers.                                                             |
| 7   | **Malware scanning needs a server.** The scanner (ClamAV) can't run on Vercel, so it needs a small always-on machine or a scanning service.                                                                                                                                                      | Medium   | Decide between hosting ClamAV and a paid scanning service. Until then, uploads are limited by type and size only. |
| 8   | **Password guessing from changing addresses.** The login limit counts per address and email together.                                                                                                                                                                                            | Medium   | Add a per-account limit that ignores the address, as was done for forms.                                          |
| 9   | **The source repository is public.** The secret scan passes, so no keys are exposed, but the code and its history are readable by anyone.                                                                                                                                                        | Low      | Confirm this is intended, or make it private.                                                                     |
| 10  | **The audit log can be changed by someone with database access.** It isn't tamper-evident.                                                                                                                                                                                                       | Low      | Accept for now and say so in the Trust Center.                                                                    |
| 11  | **Public database roles keep a spare permission.** The signed-out and signed-in roles still hold TRUNCATE on tables, a Supabase default. The API offers no way to use it, so this is a second line of defence, not an open hole.                                                                 | Low      | Remove it in a migration.                                                                                         |

## Expected changes to the dates

Day 0 is 13 November 2026. These are estimates. They assume the
decisions below arrive in the first week.

| #   | Row                         | Plan date       | Expected                   | Why                                                                                        |
| --- | --------------------------- | --------------- | -------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | Initial security audit      | Day 7 (20 Nov)  | Day 5                      | Most of the mapping exists.                                                                |
| 2   | Stop customer-data leaks    | Day 21 (4 Dec)  | Day 12                     | The controls exist. The work is the green test run and the route checklist.                |
| 3   | Protect accounts            | Day 25 (8 Dec)  | Day 14                     | Small code changes, plus settings only an owner can change in Supabase.                    |
| 4   | Protect infrastructure/data | Day 30 (13 Dec) | Day 30, **at risk**        | Depends on the Supabase plan and on someone with owner access doing the restore test.      |
| 5   | Automate testing            | Day 30 (13 Dec) | Day 7                      | Trivy and the test-run fix are quick. Aikido needs an account created and the repo linked. |
| 6   | Protect public forms        | Day 35 (18 Dec) | Day 21, **partly at risk** | Turnstile and abuse reporting are quick. Malware scanning waits on risk 7.                 |
| 7   | Granular team permissions   | Day 50 (2 Jan)  | Day 14                     | Built. Only the written table and any missing tests remain.                                |
| 8   | Private forms               | Day 55 (7 Jan)  | Day 14                     | Built. Needs a verification pass.                                                          |
| 9   | Data controls               | Day 60 (12 Jan) | Day 21                     | Built. The policy text publishes with row 11.                                              |
| 10  | Security activity logs      | Day 65 (17 Jan) | Day 21                     | Three small additions.                                                                     |
| 11  | Trust Center + legal pages  | Day 70 (22 Jan) | Day 70                     | Drafts by Day 21. The date is set by legal review, not by writing.                         |
| 12  | External security test      | Day 90 (11 Feb) | Day 90, **at risk**        | Needs quotes by Day 30 to leave time for the test, the fixes and the retest.               |

## Needs your decision

None of these can be done by a developer alone. No paid tool has been
added.

1. **Supabase plan.** Confirm whether the project has daily backups. If
   not, the paid plan is about US$25 a month.
2. **Vercel plan.** The paid plan is about US$20 a month per user. With
   Supabase this is roughly ₹4,000 a month, inside the ₹5,000 guardrail,
   if infrastructure upgrades count towards it.
3. **Accounts to create:** Cloudflare Turnstile (free) and Aikido (free
   tier). An owner should create both and add the Turnstile keys in
   Vercel.
4. **Two-factor for owners and admins:** required, or left optional?
5. **Malware scanning:** host ClamAV, pay for a scanning service, or
   accept type and size limits for now and say so publicly.
6. **Who approves changes to `main`,** and whether the repository should
   stay public.
7. **Legal review and penetration test:** who gets the quotes.

## Not verified

I could not see these from the code, so they are not counted as done:

- The live Supabase Auth settings and the project's plan and backups.
- Whether `main` has any protection rules on GitHub.
- Who currently holds admin access to Vercel, Supabase and GitHub.
- Why the GitHub test run failed before November (the logs need a
  signed-in account).
