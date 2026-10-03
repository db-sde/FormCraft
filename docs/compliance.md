# Security and privacy: what FormCraft does, and what it doesn't claim

This page lists the controls that exist in the code, so a customer's
security or legal team can assess them. It is a description, not an
attestation.

**FormCraft holds no certifications.** It has not been audited for
SOC 2 or ISO 27001, is not HIPAA-compliant, has no PCI DSS attestation
of its own, and nobody has assessed it against GDPR on your behalf.
Nothing in the product or these docs should be read as claiming
otherwise. Whether a deployment meets a given standard depends on how
and where it is run, the agreements the operator has with its providers,
and an assessment only the operator can commission.

## Controls in the product

| Area                 | What exists                                                                                                                                                                                                                                                                                         | Where                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Tenant isolation     | Row-level security on every table; the service-role key never reaches the browser; every server path re-checks workspace membership                                                                                                                                                                 | `docs/database.md`            |
| Access control       | Owner / admin / editor / viewer, plus per-member permissions (see responses, export, publish, manage integrations), enforced in the database                                                                                                                                                        | migrations 28, 34             |
| Authentication       | Password (Supabase Auth), optional TOTP two-factor with recovery codes — enforced in the database, not only the UI; SAML single sign-on that a workspace can require                                                                                                                                | migrations 37, 39             |
| Provisioning         | SCIM 2.0 (Users): the identity provider decides who may join and removes people when they leave the directory                                                                                                                                                                                       | `docs/api.md`                 |
| Audit trail          | Server-written log of security-relevant actions (publishing, members, roles, keys, exports, retention, 2FA, SSO, privacy requests); readable by owners and admins; holds no answers                                                                                                                 | migration 33                  |
| Encryption           | In transit: TLS, provided by the host. At rest: provided by the database host. Integration credentials are additionally encrypted in the application (AES-256-GCM, key from `APP_SECRET`)                                                                                                           | `ARCHITECTURE.md`             |
| Secrets              | API keys, SCIM tokens, resume links, invitations and recovery codes are stored as SHA-256 hashes and shown once                                                                                                                                                                                     | migrations 26, 28, 30, 37, 39 |
| Data retention       | Unfinished responses: per form. Completed responses: per workspace (7 days to 10 years, or keep). Deleted forms are purged after 30 days, files included                                                                                                                                            | migration 33                  |
| Access and erasure   | Settings → Security → Privacy requests: find one person's responses by email, export them as JSON, delete them and their files                                                                                                                                                                      | migration 40                  |
| Data minimisation    | FormCraft's own cookie on a form is one random visitor id (for A/B tests and "ask once" questions); its analytics events carry ids, never answers; AI features don't send emails, phone numbers or files. A creator can add their own analytics or ad pixels to a form, which set their own cookies | `DECISIONS.md`                |
| Payments             | Card data never touches FormCraft: respondents pay on Stripe Checkout, on the creator's own Stripe account                                                                                                                                                                                          | migration 32                  |
| Abuse and resilience | Rate limits on the public endpoints, spam trap, idempotent submission, signed webhooks, SSRF checks on outbound URLs                                                                                                                                                                                | `docs/api.md`                 |

## What it does not do

- No customer-managed encryption keys, and no field-level encryption of
  answers.
- No data-residency controls of its own: data lives wherever the
  operator's Supabase project and hosting region are.
- "Ask once per person" remembers answers against the browser's visitor
  id for up to 13 months, per workspace. It identifies a browser, not a
  person; whether that needs consent where you operate is the
  creator's call. A privacy request that deletes someone's responses
  also forgets what their browser was remembered by.
- No built-in consent management (a form can include its own consent
  question; whether that is sufficient is the creator's call).
- Privacy requests search for an email address as an answer or in a
  contact step. Personal details typed into other answers aren't found
  automatically, and data already delivered to integrations (webhooks,
  Google Sheets, HubSpot, Slack, email) must be removed there.
- Backups and their retention are the database host's; erasing a
  response does not reach into backups already taken.
- The audit log is append-only to members, but an operator with database
  access could alter it; it is not tamper-evident.
- SCIM covers Users only (no Groups); roles are set inside FormCraft.

## Other services data can pass through

Which of these are in use depends on the deployment's configuration.

| Service                                | What it receives                                                               | When                                      |
| -------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------- |
| Supabase                               | Everything stored: accounts, forms, responses, files                           | Always                                    |
| The web host (e.g. Vercel)             | Requests and responses in transit; logs                                        | Always                                    |
| Resend                                 | Recipient address and the content of notification, confirmation, invite emails | If email is configured                    |
| PostHog                                | Product events with ids (no answers)                                           | If configured                             |
| Sentry                                 | Error reports                                                                  | If configured                             |
| Anthropic                              | Form text; for response analysis and follow-ups, written answers (minimised)   | Only if an API key is set and a user asks |
| Stripe                                 | Amount, description, response id — on the creator's own account                | Forms with payments                       |
| Google Sheets, HubSpot, Slack, Zapier… | Whatever the creator maps or sends                                             | Integrations the creator turns on         |

An operator offering FormCraft to others is the party that would sign
data-processing agreements with its customers and with these providers.
The software doesn't supply one.

## For an operator preparing for an assessment

Things the code can't do for you: enable TOTP and (for SSO) SAML in
Supabase Auth; choose regions; turn on database backups and decide their
retention; restrict who holds the service-role key and `APP_SECRET`;
set `CRON_SECRET` and run the retention job; monitor `/api/cron/health`;
keep dependencies patched; and write the policies an auditor will ask
for (incident response, access reviews, vendor management).
