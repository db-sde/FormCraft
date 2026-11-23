# Integration audit register (roadmap v3.1 §J)

**Audited:** 20 November 2026, against the working tree on `claude/hardening`
(uncommitted), on the local stack: Supabase in Docker, the app built and
served the way the `prod-3007` launch config does, and the stand-in
providers the tests start (`tests/e2e/fake-email-server.mjs` for Resend;
fake Stripe, Anthropic, Airtable, Razorpay and Google Places servers on
ports 4600–4605 started by `playwright.config.ts` and the specs; per-test
`fetch` fakes in the integration tests).

**What "Working" means here.** Every result below is local. A stand-in
proves FormCraft's half: the request it sends, how it reads the answer,
retries, idempotency, tenant isolation and what the creator sees. It does
not prove the real provider accepts it. No provider account was
available for this audit, so **no row is marked Working against a real
provider**. Where a real account is the only way to finish the check, the
result says **Not testable** and names the blocker, per §J2. The
"Launch disposition" column follows §J2's four values.

**Production (https://form-craft-ivory.vercel.app), read-only check.**
`vercel env ls --environment production` lists only `APP_SECRET`,
`CRON_SECRET`, `EMAIL_FROM`, `GOOGLE_OAUTH_REDIRECT_URI`,
`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_POSTHOG_HOST` and the three Supabase
settings. So on production every OAuth app, every Google feature, email,
AI, address suggestions and CAPTCHA are **off**, and their sections show
the "isn't set up on this site yet" note with no Connect button (the
switch-off logic is the same code tested locally with the keys unset).
Bring-your-own-key connections (webhooks, n8n, Slack, Stripe, Razorpay,
HubSpot, data lookups, pixels, embeds) need no site key and are live
there. Nothing was changed or created on production.

**Ownership.** The repository has one developer; every row's engineering
owner is the FormCraft developer (this repo's owner), and every
provider-account owner is the product owner, who must create or supply the
accounts listed under prerequisites. Named people need assigning in the
tracker.

**Evidence files.** Test names below are the evidence: each is an
automated check in this repo that ran green on 20 November 2026 (see
"Test runs" at the end for the commands and totals).

---

## Summary matrix

| #   | Integration (as labelled in the UI)                                                                     | Roadmap                      | Priority                  | UI claim on production                   | Local test result                        | Launch disposition                           |
| --- | ------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------- | ---------------------------------------- | ---------------------------------------- | -------------------------------------------- |
| 1   | Webhooks                                                                                                | #53 (part)                   | Build Now / Unmapped base | Available                                | Working (stand-in receiver)              | Verified active (local)                      |
| 2   | Webhooks → n8n workflow                                                                                 | #49                          | Build Now                 | Available                                | Partially working                        | Blocked with owner approval (native node)    |
| 3   | Webhooks → unfinished responses (partial)                                                               | #53                          | Build Now                 | Available                                | Working (stand-in receiver)              | Verified active (local)                      |
| 4   | Google Sheets                                                                                           | Unmapped                     | Unmapped (Phase 1)        | Not set up on this site yet              | Partially working / Not testable         | Deferred and clearly labeled                 |
| 5   | Slack                                                                                                   | Unmapped                     | Unmapped (P2.14)          | Available                                | Partially working / Not testable         | Blocked: needs a Slack test workspace        |
| 6   | Payment → Stripe (+ Settings → Connections)                                                             | #22                          | Build Now — At the End    | Available                                | Working (fake Stripe)                    | Blocked with owner approval (exposed early)  |
| 7   | Payment → Razorpay / UPI (+ Settings → Connections)                                                     | #35                          | Build Now — At the End    | Available                                | Working (fake Razorpay)                  | Blocked with owner approval (exposed early)  |
| 8   | HubSpot (+ Settings → Connections)                                                                      | Unmapped                     | Unmapped (P2.15)          | Available                                | Working (fake HubSpot)                   | Blocked: needs a HubSpot test portal         |
| 9   | Apps → Airtable                                                                                         | #33                          | Build Now                 | Not set up on this site yet              | Working (fake Airtable, full UI)         | Deferred and clearly labeled (keys)          |
| 10  | Apps → Salesforce                                                                                       | #34                          | Build Now                 | Not set up on this site yet              | Working (fetch fake); OAuth Not testable | Fixed and verified (local) + labeled         |
| 11  | Apps → Notion                                                                                           | #36                          | Build Now                 | Not set up on this site yet              | Working (fetch fake); OAuth Not testable | Fixed and verified (local) + labeled         |
| 12  | Apps → Mailchimp                                                                                        | #38                          | Build Now                 | Not set up on this site yet              | Working (fetch fake); OAuth Not testable | Deferred and clearly labeled (keys)          |
| 13  | Apps → Zoho CRM                                                                                         | #40                          | Build Now                 | Not set up on this site yet              | **Was broken** → fixed (fetch fake)      | Fixed and verified (local) + labeled         |
| 14  | Apps → Pipedrive                                                                                        | #40                          | Build Now                 | Not set up on this site yet              | Working (fetch fake); OAuth Not testable | Fixed and verified (local) + labeled         |
| 15  | Apps → Google Drive                                                                                     | #50                          | Build Now                 | Not set up on this site yet              | Working (fetch fake); OAuth Not testable | Deferred and clearly labeled (keys)          |
| 16  | Data lookups                                                                                            | Unmapped                     | Unmapped                  | Available                                | Working (stand-in API)                   | Verified active (local)                      |
| 17  | Confirmation email                                                                                      | #25                          | Build Now                 | Not set up on this site yet              | Working (fake Resend)                    | Deferred and clearly labeled (keys)          |
| 18  | Email notifications (alert, rules, digest)                                                              | #25                          | Build Now                 | Not set up on this site yet              | Working (fake Resend)                    | Deferred and clearly labeled (keys)          |
| 19  | PDF documents (download / email)                                                                        | #7                           | Build Now                 | Available (email part not set up)        | Working (download); email via fake       | Verified active (download, local)            |
| 20  | Analytics → Google Analytics, Tag Manager, Meta Pixel                                                   | Unmapped                     | Unmapped (P2.12)          | Available                                | Partially working / Not testable         | Blocked: needs provider test properties      |
| 21  | Analytics → LinkedIn Insight Tag, TikTok Pixel                                                          | #44                          | Build Now                 | Available                                | Partially working / Not testable         | Blocked: needs provider test accounts        |
| 22  | Bookings → Google Calendar                                                                              | #43 (in #27)                 | Build Now                 | Not set up on this site yet              | Working (fetch fake); OAuth Not testable | Deferred and clearly labeled (keys)          |
| 23  | Share → Embed on your website (inline, popup, SDK)                                                      | #24                          | Build Now                 | Available                                | Working                                  | Verified active (local)                      |
| 24  | Share → Email / WhatsApp / LinkedIn / X share links                                                     | Unmapped                     | Not applicable            | Available                                | Not applicable (share intents)           | Verified active (links only)                 |
| 25  | Settings → API keys ("Zapier, Make or your own code")                                                   | Unmapped                     | Unmapped (P2.13)          | Available (copy corrected)               | Working (API); no directory apps         | Blocked with owner approval (listings)       |
| 26  | Settings → Domains (automatic connection via Vercel)                                                    | Unmapped                     | Unmapped                  | Manual DNS only (auto not set up)        | Working (manual); auto Not testable      | Deferred and clearly labeled                 |
| 27  | Settings → Security: SSO (SAML) and SCIM                                                                | Unmapped                     | Unmapped                  | Available (Enterprise plan)              | SCIM working; SAML Not testable          | Blocked: needs a SAML IdP test tenant        |
| 28  | Builder → Address suggestions (Google Places)                                                           | #65                          | Build Now                 | Not set up on this site yet (switch off) | Working (fake Places)                    | Deferred and clearly labeled (keys)          |
| 29  | Builder → Email verification code                                                                       | #8                           | Build Now — At the End    | Not set up on this site yet (switch off) | Working (fake Resend)                    | Deferred and clearly labeled (keys)          |
| 30  | Form settings → CAPTCHA (Cloudflare Turnstile)                                                          | #26                          | Build Now                 | Not set up on this site yet (switch off) | Not testable (no Turnstile keys)         | Deferred and clearly labeled (keys)          |
| 31  | Builder / Responses → AI (Edit with AI, insights)                                                       | #23, #30                     | Build Now                 | Not set up on this site yet              | Working (fake Anthropic)                 | Deferred and clearly labeled (keys)          |
| 32  | Endings → Calendly / Cal.com booking page                                                               | Unmapped                     | Unmapped (P2.16)          | Available                                | Working (link check + embed)             | Verified active (local)                      |
| 33  | Dashboard → Import a form (Google Forms / Typeform link)                                                | #5                           | Build Now                 | Available                                | Working (unit fixtures)                  | Verified active (local)                      |
| —   | PayPal, Microsoft 365 / Outlook, SMS (MSG91/Twilio), WhatsApp Business, Zendesk / Intercom, custom SMTP | #37, #39, #41, #42, #45, #57 | Build Later               | **Not listed anywhere**                  | Not applicable                           | Deferred (not shown); guarded by a unit test |

---

## Bugs found and fixed in this audit

| ID    | Severity      | Integration                                                        | Reproduction                                                                                                                                                                                                                                                               | Root cause                                                                                                                                 | Fix (uncommitted, for review)                                                                                                                                                                                                                                                                                                            | Regression tests                                                                                                                                                                      |
| ----- | ------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IA-01 | High          | Zoho CRM (#40)                                                     | Connect a Zoho account in the EU, India, Australia, Japan… data centre. Zoho redirects back with `accounts-server=https://accounts.zoho.in`; FormCraft exchanged the code at accounts.zoho.com → `invalid_code` → "couldn't be connected". Refreshes had the same problem. | `tokenUrl` was fixed to the US accounts server; Zoho only accepts a code or refresh token at the account's own centre.                     | `src/domains/connectors/oauth.ts`: `zohoAccountsServer()` (allowlist of Zoho's own accounts servers, since the client secret is sent there), used for the code exchange and kept in the tokens (`accounts_server`) for refreshes. `oauth/callback/route.ts` passes `accounts-server`. `.env.example`: the Zoho client needs Multi-DC on. | `tests/unit/integration-audit.test.ts` (Zoho data centres ×4); `tests/integration/connectors-notion-zoho.test.ts` ("refreshes an expired token at the account's own accounts server") |
| IA-02 | Medium        | Salesforce, Zoho, Airtable, Notion, Pipedrive (#33, #34, #36, #40) | Map a **Date and time** question to a date-time field (or a Notion date). The response syncs as "2026-11-20 14:00 (UTC+05:30)"; the app refuses it (400) and the sync fails. Mapping anything non-ISO to a _date_ field sent its first ten characters ("Tue, 3 Nov").      | Mapping sends answers as display text (like exports); providers passed it straight to date-time fields and sliced it for date fields.      | `src/domains/connectors/links.ts`: `asDateTime()` (display text or ISO → ISO 8601 UTC) and `asDate()` (YYYY-MM-DD or nothing). Used by each provider's date and date-time conversion; a value that isn't a date is a mapping problem on the response timeline, not a mangled value. Zoho gets `+00:00` instead of `Z`.                   | `tests/unit/integration-audit.test.ts` ("dates and date-times sent to apps" ×3); `tests/integration/connectors-notion-zoho.test.ts` (Notion page and Zoho lead carry the ISO time)    |
| IA-03 | Low           | All OAuth connectors (#33–#36, #38, #40, #43, #50)                 | Start connecting an app, wait more than 10 minutes at the provider (or finish in another browser). The callback redirected to Settings → Account with `connect_error=expired`, which nothing displayed: the connection silently didn't happen.                             | The return path is inside the state, which can't be verified once expired, so the callback fell back to `/settings`, which had no message. | Callback returns to the page the flow started on, read from the unsigned state through `safeReturnPath` (only an app path, never another site), where the "took too long" note shows; Integrations gained that message; Settings shows a fallback note.                                                                                  | `tests/unit/integration-audit.test.ts` ("a connection flow that can't be verified" ×2)                                                                                                |
| IA-04 | Low           | Airtable, Pipedrive labels                                         | The connection label lookup called api.airtable.com even with the stand-in configured (tests sent fake tokens to the real API), and Pipedrive's on api.pipedrive.com instead of the company domain its OAuth tokens are for.                                               | Hard-coded hosts in `accounts.ts`.                                                                                                         | Airtable uses `AIRTABLE_API_BASE`; Pipedrive uses the token's `api_domain` (only `*.pipedrive.com`).                                                                                                                                                                                                                                     | `tests/unit/integration-audit.test.ts` ("connection labels" ×2)                                                                                                                       |
| IA-05 | Medium (copy) | Every "needs setup" feature                                        | Production showed "Google Sheets is almost here… We're putting the finishing touches on this one… It'll switch on right here as soon as it's ready" for features that wait on provider accounts with no date.                                                              | 2026-11-07 copy decision, now contrary to §J4 "honest product copy".                                                                       | `src/lib/not-set-up.ts`: "… isn't set up on this site yet", no promise of a date; the CAPTCHA hint and email-invite message likewise; the Apps note lists the apps and says webhooks work now. DECISIONS.md 2026-11-20.                                                                                                                  | `tests/unit/not-set-up.test.tsx`; `tests/unit/integration-audit.test.ts` ("never promises…"); `tests/e2e/qa-retest.spec.ts`                                                           |
| IA-06 | Medium (copy) | Settings → API                                                     | "Connect Zapier, Make or your own code" implied a Zapier/Make app; there is none in either directory, so a creator searching Zapier for FormCraft finds nothing.                                                                                                           | Listing publication is an external step never taken (DECISIONS 2026-10-02).                                                                | Copy now says what keys are for and how to reach Zapier/Make today (a Catch Hook / Custom webhook URL in Webhooks).                                                                                                                                                                                                                      | `tests/unit/integration-audit.test.ts` ("doesn't claim a Zapier or Make app…")                                                                                                        |

No other connector failed a local check. Nothing in the 68-feature
priorities was changed, and no deferred connector was built.

---

## Register: one entry per connection

Field order is §J2's. "Env" lists the server settings; "accounts" the
provider accounts the owner must supply.

### 1. Webhooks

| Field                  | Value                                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name / UI location     | "Webhooks", form → Integrations (`/forms/[id]/integrations`), first section; desktop and phone use the same page.                                                                                                                                                                                                                     |
| Roadmap / priority     | Generic webhooks predate the 68 (Phase 1); unfinished-response events are #53 (Build Now).                                                                                                                                                                                                                                            |
| UI claim               | Available on every environment.                                                                                                                                                                                                                                                                                                       |
| Test result            | **Working** against stand-in receivers.                                                                                                                                                                                                                                                                                               |
| Failure details        | None found.                                                                                                                                                                                                                                                                                                                           |
| Root cause / fix       | —                                                                                                                                                                                                                                                                                                                                     |
| Ownership              | FormCraft developer; customer owns the receiving endpoint.                                                                                                                                                                                                                                                                            |
| External prerequisites | `APP_SECRET` (signing), `CRON_SECRET` + the Supabase scheduler (retries, set 2026-11-20). No provider account.                                                                                                                                                                                                                        |
| QA evidence            | `tests/integration/webhook-workers.test.ts` (10 cases: payload from stored data, one delivery per event, spam/unfinished skipped, recovery sweep exactly once, leases, backlog isolation, gives up after last attempt, unreachable destination isolated); unit tests for signing, backoff and URL safety; e2e `api-contract.spec.ts`. |
| Launch disposition     | Verified active (local). A smoke test against a real public receiver (e.g. webhook.site) is still owed before sign-off.                                                                                                                                                                                                               |

### 2. Webhooks → n8n

| Field                  | Value                                                                                                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name / UI location     | "Send responses to your own server, or to an n8n workflow" — same Webhooks section (endpoint kind `n8n`); setup in `docs/n8n.md`.                                                              |
| Roadmap / priority     | #49 Native n8n integration — Build Now.                                                                                                                                                        |
| UI claim               | Available.                                                                                                                                                                                     |
| Test result            | **Partially working**: the signed request n8n's Webhook node receives is the tested webhook path above. No n8n instance was available to run a workflow; there is no FormCraft community node. |
| Failure details        | —                                                                                                                                                                                              |
| Root cause / fix       | —                                                                                                                                                                                              |
| Ownership              | FormCraft developer.                                                                                                                                                                           |
| External prerequisites | An n8n instance (cloud or self-hosted) for a smoke test. §J3 asks the owner to **clarify whether "native" means a published n8n community node**; that would be new work.                      |
| QA evidence            | As row 1; `docs/n8n.md` signature-verification recipe.                                                                                                                                         |
| Launch disposition     | Blocked with owner approval: decide webhook-based vs native node.                                                                                                                              |

### 3. Webhooks → unfinished responses

| Field                  | Value                                                                                                                                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name / UI location     | Per-endpoint event choice in Webhooks ("Completed ones by default; unfinished ones if you choose"); needs Settings → "save partial responses".                                                                                                             |
| Roadmap / priority     | #53 Partial-response webhooks — Build Now.                                                                                                                                                                                                                 |
| UI claim               | Available.                                                                                                                                                                                                                                                 |
| Test result            | **Working** (stand-in receiver).                                                                                                                                                                                                                           |
| Failure details        | None.                                                                                                                                                                                                                                                      |
| Root cause / fix       | —                                                                                                                                                                                                                                                          |
| Ownership              | FormCraft developer.                                                                                                                                                                                                                                       |
| External prerequisites | As row 1.                                                                                                                                                                                                                                                  |
| QA evidence            | `tests/integration/partial-webhooks.test.ts` (5: bursts coalesce to one event with latest answers, abandoned/resumed once each, none when the form keeps no partials, never stands in for the completed delivery, endpoint without "completed" gets none). |
| Launch disposition     | Verified active (local).                                                                                                                                                                                                                                   |

### 4. Google Sheets

| Field                  | Value                                                                                                                                                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Name / UI location     | "Google Sheets" section, form → Integrations.                                                                                                                                                                                                                                                    |
| Roadmap / priority     | Unmapped (Phase 1 spec, before the 68). Owner decision needed on priority.                                                                                                                                                                                                                       |
| UI claim               | Production: "Google Sheets isn't set up on this site yet" note, no Connect button, CSV alternative named.                                                                                                                                                                                        |
| Test result            | **Partially working**: sync, token refresh, retries, formula-injection safety verified against a fake Sheets API. **Not testable**: Google consent and a real spreadsheet.                                                                                                                       |
| Failure details        | —                                                                                                                                                                                                                                                                                                |
| Root cause / fix       | —                                                                                                                                                                                                                                                                                                |
| Ownership              | FormCraft developer; Google Cloud project owner = product owner.                                                                                                                                                                                                                                 |
| External prerequisites | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` (only the redirect URI is set on production); Google OAuth app verification for the Sheets scope; a test Google account.                                                                                     |
| QA evidence            | `tests/integration/sheets.test.ts` (10 incl. "syncs a completed response's answers to the fake Sheets API end to end, including a token refresh", "encrypts tokens at rest", "writes respondent text as literal cells"); `tests/e2e/qa-retest.spec.ts` (note shown, no "Connect Google Sheets"). |
| Launch disposition     | Deferred and clearly labeled until the Google app exists.                                                                                                                                                                                                                                        |

### 5. Slack

| Field                  | Value                                                                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name / UI location     | "Slack" section, form → Integrations (paste an incoming-webhook URL).                                                                                                        |
| Roadmap / priority     | Unmapped (P2.14). Owner decision needed.                                                                                                                                     |
| UI claim               | Available (plan-gated).                                                                                                                                                      |
| Test result            | **Partially working**: only `https://hooks.slack.com/services/…` accepted; message built and queued through the webhook queue. **Not testable**: a post into a real channel. |
| Failure details        | —                                                                                                                                                                            |
| Root cause / fix       | —                                                                                                                                                                            |
| Ownership              | FormCraft developer; customer owns the Slack workspace.                                                                                                                      |
| External prerequisites | None on the site. For QA: a Slack test workspace with an incoming webhook.                                                                                                   |
| QA evidence            | `tests/integration/outbound.test.ts` ("only point at Slack"); `tests/unit/outbound.test.ts` ("only accepts Slack's own webhook URLs").                                       |
| Launch disposition     | Blocked until one real post is recorded (needs a Slack test workspace).                                                                                                      |

### 6. Payment → Stripe

| Field                  | Value                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name / UI location     | "Payment" section, form → Integrations; keys in Settings → Connections ("Connect Stripe").                                                                                                              |
| Roadmap / priority     | #22 Payments enhancement — Build Now — At the End (one epic with #35).                                                                                                                                  |
| UI claim               | Available (bring your own keys; plan-gated).                                                                                                                                                            |
| Test result            | **Working** against the fake Stripe API: server-computed amount, Checkout, only Stripe's signed webhook marks it paid, refunds recorded. **Not testable**: Stripe test mode with real keys.             |
| Failure details        | —                                                                                                                                                                                                       |
| Root cause / fix       | —                                                                                                                                                                                                       |
| Ownership              | FormCraft developer; customer owns the Stripe account.                                                                                                                                                  |
| External prerequisites | Customer's Stripe secret key + webhook signing secret (webhook URL shown in Settings). For QA: a Stripe test-mode account.                                                                              |
| QA evidence            | `tests/e2e/payments.spec.ts` ("respondents pay on Stripe, and only Stripe's word marks it paid"); `tests/integration/payments-crm.test.ts`, `payments-razorpay.test.ts` ("records Stripe refunds too"). |
| Launch disposition     | **Owner decision**: §J3 says to test payments only in the final-phase scope, but it is already exposed as available. Keep (and run a Stripe test-mode smoke) or hide until the final phase.             |

### 7. Payment → Razorpay / UPI

| Field                  | Value                                                                                                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name / UI location     | "Payment" section; keys in Settings → Connections ("Connect Razorpay", keys checked before saving).                                                                                                                                          |
| Roadmap / priority     | #35 Razorpay/UPI — Build Now — At the End.                                                                                                                                                                                                   |
| UI claim               | Available (bring your own keys).                                                                                                                                                                                                             |
| Test result            | **Working** against the fake Razorpay API and checkout script: orders reused per amount, signature + capture required, duplicate/out-of-order webhooks settle once, partial and full refunds, coupons. **Not testable**: Razorpay test mode. |
| Failure details        | —                                                                                                                                                                                                                                            |
| Root cause / fix       | —                                                                                                                                                                                                                                            |
| Ownership              | FormCraft developer; customer owns the Razorpay account.                                                                                                                                                                                     |
| External prerequisites | Customer's key id/secret + webhook secret. For QA: a Razorpay test account.                                                                                                                                                                  |
| QA evidence            | `tests/e2e/phase7.spec.ts` (pay in the form with a coupon; pay later from the payment link); `tests/e2e/creator-setup.spec.ts` (keys checked before saving; coupons); `tests/integration/payments-razorpay.test.ts` (9).                     |
| Launch disposition     | Same owner decision as row 6.                                                                                                                                                                                                                |

### 8. HubSpot

| Field                  | Value                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Name / UI location     | "HubSpot" section, form → Integrations; private-app token in Settings → Connections.                                                   |
| Roadmap / priority     | Unmapped (P2.15). Owner decision needed.                                                                                               |
| UI claim               | Available (plan-gated).                                                                                                                |
| Test result            | **Working** against a fake HubSpot API (contact updated by email or created). **Not testable**: a real portal.                         |
| Failure details        | —                                                                                                                                      |
| Root cause / fix       | —                                                                                                                                      |
| Ownership              | FormCraft developer; customer owns the HubSpot portal.                                                                                 |
| External prerequisites | Customer's HubSpot private-app token. For QA: a HubSpot developer test portal.                                                         |
| QA evidence            | `tests/integration/payments-crm.test.ts` ("updates the contact by email, or creates it when there isn't one", "are stored encrypted"). |
| Launch disposition     | Blocked until a test-portal smoke is recorded.                                                                                         |

### 9–15. Apps (Airtable, Salesforce, Notion, Mailchimp, Zoho CRM, Pipedrive, Google Drive)

Shared facts for all seven:

| Field                   | Value                                                                                                                                                                                                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI location             | "Apps" section, form → Integrations. An app is listed with a Connect button **only** when its OAuth client is set on the server (`isConfigured`); otherwise "Apps aren't set up on this site yet. That's Airtable, Salesforce, Notion, Mailchimp, Zoho CRM, Pipedrive and Google Drive…", and none can be connected.                   |
| UI claim on production  | Not set up on this site yet (no `*_CLIENT_ID` / `*_CLIENT_SECRET` set).                                                                                                                                                                                                                                                                |
| Shared machinery tested | Signed state + nonce cookie + PKCE, workspace binding, encrypted tokens, refresh, invalid → "Reconnect", disconnect, one job per response, retries with backoff, replay, recovery sweep, conditions, confidential forms skipped. `tests/integration/connectors.test.ts` (11), `tests/unit/phase6.test.ts`, `tests/e2e/phase6.spec.ts`. |
| Shared prerequisites    | `APP_SECRET`, `NEXT_PUBLIC_APP_URL`; per app an OAuth client registered with redirect URI `${NEXT_PUBLIC_APP_URL}/api/connectors/oauth/callback`; a test account in each app for the real smoke.                                                                                                                                       |
| Ownership               | FormCraft developer; each app's developer account = product owner.                                                                                                                                                                                                                                                                     |

| Row | App          | Roadmap       | Env                                                            | Test result                                                                                                                                                                                                                                               | QA evidence                                                                 | Disposition                                                |
| --- | ------------ | ------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 9   | Airtable     | #33 Build Now | `AIRTABLE_CLIENT_ID/SECRET`                                    | **Working** end to end in the browser against the fake Airtable (OAuth with PKCE, base/table pickers, mapping, a submission arrives as one record, disconnect); retries/replays don't duplicate. Real Airtable **Not testable** (no account).             | `tests/e2e/phase6.spec.ts`; `connectors.test.ts` Airtable ×6                | Deferred and clearly labeled until the OAuth client exists |
| 10  | Salesforce   | #34 Build Now | `SALESFORCE_CLIENT_ID/SECRET` (a Connected App)                | **Working** (fetch fake): refused token refreshed once, lead matched by email and updated, assignment-rule header. **Fixed** IA-02 (date-time fields). Real org **Not testable**; sandbox orgs (test.salesforce.com) aren't supported — a gap, not a bug. | `connectors.test.ts` Salesforce; `integration-audit.test.ts`                | Fixed and verified (local); labeled until keys             |
| 11  | Notion       | #36 Build Now | `NOTION_CLIENT_ID/SECRET` (public integration)                 | **Working** (fetch fake, new test): one page per response, found by the response ID on replay, unshared database explained. **Fixed** IA-02 (Notion date got display text). Real workspace **Not testable**.                                              | `connectors-notion-zoho.test.ts` Notion ×2 (new)                            | Fixed and verified (local); labeled until keys             |
| 12  | Mailchimp    | #38 Build Now | `MAILCHIMP_CLIENT_ID/SECRET`                                   | **Working** (fetch fake): only consenting people, pending for double opt-in, tags, data centre from metadata. Real audience **Not testable**.                                                                                                             | `connectors.test.ts` Mailchimp                                              | Deferred and clearly labeled until keys                    |
| 13  | Zoho CRM     | #40 Build Now | `ZOHO_CLIENT_ID/SECRET` (server-based client, **Multi-DC on**) | **Was broken** for non-US accounts (IA-01), now **fixed**: exchange and refresh at the account's own centre; upsert on Email in the account's API domain; refusals name the field. Real account **Not testable**.                                         | `connectors-notion-zoho.test.ts` Zoho ×3 (new); `integration-audit.test.ts` | Fixed and verified (local); labeled until keys             |
| 14  | Pipedrive    | #40 Build Now | `PIPEDRIVE_CLIENT_ID/SECRET` (marketplace app)                 | **Working** (fetch fake): refused token → "Reconnect", person by email, one lead per response. **Fixed** IA-02 (date fields), IA-04 (label host). Real company **Not testable**.                                                                          | `connectors.test.ts` Pipedrive ×2; `integration-audit.test.ts`              | Fixed and verified (local); labeled until keys             |
| 15  | Google Drive | #50 Build Now | `GOOGLE_OAUTH_CLIENT_ID/SECRET` (drive.file scope only)        | **Working** (fetch fake): file copied into the form's folder, per-response folder, never uploaded twice. Consent/revocation with real Google **Not testable**.                                                                                            | `tests/integration/google-drive.test.ts` (4)                                | Deferred and clearly labeled until keys                    |

### 16. Data lookups

| Field                  | Value                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name / UI location     | "Data lookups" section, form → Integrations.                                                                                                                                                                              |
| Roadmap / priority     | Unmapped. Owner decision needed.                                                                                                                                                                                          |
| UI claim               | Available (plan-gated).                                                                                                                                                                                                   |
| Test result            | **Working** against a stand-in API.                                                                                                                                                                                       |
| Failure details        | —                                                                                                                                                                                                                         |
| Root cause / fix       | —                                                                                                                                                                                                                         |
| Ownership              | FormCraft developer; customer owns the API called.                                                                                                                                                                        |
| External prerequisites | None on the site.                                                                                                                                                                                                         |
| QA evidence            | `tests/integration/data-lookups.test.ts` (4: secret encrypted, unsafe settings refused, header + encoded answer, carries on when the API fails/redirects/is too big, per-response cap); `tests/e2e/data-lookups.spec.ts`. |
| Launch disposition     | Verified active (local).                                                                                                                                                                                                  |

### 17–19. Email: confirmation, notifications, PDF documents

| Field                  | Value                                                                                                                                                                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name / UI location     | "Confirmation email", "Email notifications" and "PDF documents" sections, form → Integrations; Members → invitations.                                                                                                                                           |
| Roadmap / priority     | #25 Advanced email notifications (Build Now); #7 PDF / document generation (Build Now).                                                                                                                                                                         |
| UI claim               | Production: confirmation and notifications show "isn't/aren't set up on this site yet"; PDF documents are available to download, their email option says email isn't set up; invitations say email invites aren't set up and give the link.                     |
| Test result            | **Working** against the fake Resend server: confirmation, rule emails only to teammates who may see responses, daily digest once, certificate numbered and emailed once, failed send kept retryable. **Not testable**: delivery from a verified sending domain. |
| Failure details        | —                                                                                                                                                                                                                                                               |
| Root cause / fix       | IA-05 copy only.                                                                                                                                                                                                                                                |
| Ownership              | FormCraft developer; Resend account = product owner.                                                                                                                                                                                                            |
| External prerequisites | `RESEND_API_KEY`, `EMAIL_FROM` on a domain verified in Resend (SPF/DKIM).                                                                                                                                                                                       |
| QA evidence            | `tests/integration/documents-notifications.test.ts` (6); `tests/e2e/creator-setup.spec.ts` ("a notification rule is saved for a teammate, and emails them on a response"); `tests/e2e/phase3.spec.ts` (registration PDF numbered and downloaded).               |
| Launch disposition     | Deferred and clearly labeled until Resend is set up; PDF download verified active (local).                                                                                                                                                                      |

### 20–21. Analytics and ad pixels

| Field                  | Value                                                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name / UI location     | "Analytics and ad pixels" section, form → Integrations: Google Analytics, Tag Manager, Meta, LinkedIn (partner + conversion id), TikTok, and "ask for consent first".                        |
| Roadmap / priority     | LinkedIn Insight / TikTok Pixel #44 Build Now; GA/GTM/Meta unmapped (P2.12).                                                                                                                 |
| UI claim               | Available (plan-gated).                                                                                                                                                                      |
| Test result            | **Partially working**: scripts load only after consent, declining loads none, ad ids are validated before they reach the page. **Not testable**: events arriving in each vendor's dashboard. |
| Failure details        | —                                                                                                                                                                                            |
| Root cause / fix       | —                                                                                                                                                                                            |
| Ownership              | FormCraft developer; customer owns each ad account.                                                                                                                                          |
| External prerequisites | None on the site. For QA: a GA4 property, GTM container, Meta pixel, LinkedIn Campaign Manager and TikTok Ads test account.                                                                  |
| QA evidence            | `tests/e2e/phase3.spec.ts` ("pixels wait for consent, and declining loads none"); `tests/unit/phase3.test.ts` ("pixels (F-44)").                                                             |
| Launch disposition     | Blocked until one vendor-side event per pixel is recorded.                                                                                                                                   |

### 22. Bookings → Google Calendar

| Field                  | Value                                                                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name / UI location     | Bookings page (`/bookings`), "Connect Google Calendar" (personal to each host).                                                                                                                             |
| Roadmap / priority     | #43 inside #27 native booking — Build Now. Outlook (§J3, #39) is not offered.                                                                                                                               |
| UI claim               | Production: "Google Calendar isn't set up on this site yet"; bookings still work without it.                                                                                                                |
| Test result            | **Working** (fetch fake): each event created once, failures retried, auth errors stop and mark for reconnecting, an unreadable calendar hides the host. **Not testable**: real Google consent and calendar. |
| Failure details        | —                                                                                                                                                                                                           |
| Root cause / fix       | IA-03 (expired flow now lands back on Bookings with its message).                                                                                                                                           |
| Ownership              | FormCraft developer; Google Cloud project = product owner.                                                                                                                                                  |
| External prerequisites | `GOOGLE_OAUTH_CLIENT_ID/SECRET`; Google verification of the calendar scopes.                                                                                                                                |
| QA evidence            | `tests/integration/bookings.test.ts` (7); `tests/e2e/phase5.spec.ts` ("connecting a calendar without server credentials explains itself", booking, cancel).                                                 |
| Launch disposition     | Deferred and clearly labeled until keys. Owner to clarify the Outlook requirement under #27.                                                                                                                |

### 23. Share → Embed on your website

| Field                          | Value                                                                                                                                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name / UI location             | Form → Share (`/forms/[id]/share`): embed code (inline, popup, SDK), allowed sites in form settings.                                                                                                      |
| Roadmap / priority             | #24 Advanced embed modes — Build Now.                                                                                                                                                                     |
| UI claim                       | Available.                                                                                                                                                                                                |
| Test result                    | **Working**.                                                                                                                                                                                              |
| QA evidence                    | `tests/e2e/embed.spec.ts`; `tests/e2e/phase3.spec.ts` ("the embed SDK opens a popup on another site and counts it once"); `tests/e2e/creator-setup.spec.ts` ("only the listed sites may embed the form"). |
| External prerequisites / owner | None / FormCraft developer.                                                                                                                                                                               |
| Launch disposition             | Verified active (local).                                                                                                                                                                                  |

### 24. Share links

Email (`mailto:`), WhatsApp (`wa.me`), LinkedIn and X share links on the
Share page. These open the respondent-facing share dialogs of those
sites; no account or connection. **Not applicable** as integrations; the
WhatsApp link is not the deferred WhatsApp Business connector (#42).

### 25. Settings → API keys (Zapier / Make)

| Field                  | Value                                                                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name / UI location     | Settings → API.                                                                                                                                                                                             |
| Roadmap / priority     | Unmapped (P2.13).                                                                                                                                                                                           |
| UI claim               | Was "Connect Zapier, Make or your own code"; now says what keys do and how to reach Zapier/Make today (IA-06).                                                                                              |
| Test result            | **Working** for the API itself (authenticate, list forms, sample, subscribe/unsubscribe REST hooks). No FormCraft app exists in the Zapier or Make directories.                                             |
| External prerequisites | Publishing Zapier and Make apps (developer accounts, review).                                                                                                                                               |
| QA evidence            | `tests/e2e/public-api.spec.ts` ("Zapier/Make: authenticate, list forms, sample, subscribe and unsubscribe"); `tests/integration/outbound.test.ts` (keys hashed, revoked keys take subscriptions with them). |
| Launch disposition     | Blocked with owner approval: publish listings or keep API-only.                                                                                                                                             |

### 26. Settings → Domains (automatic connection)

| Field                  | Value                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Name / UI location     | Settings → Domains.                                                                                                                  |
| Roadmap / priority     | Unmapped.                                                                                                                            |
| UI claim               | Manual DNS records always; automatic TLS connection only with the Vercel token (not set on production, so the page gives DNS steps). |
| Test result            | **Working** for verified domains serving only their workspace's forms. **Not testable**: Vercel's domain API.                        |
| External prerequisites | `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID` (`VERCEL_TEAM_ID`).                                                                          |
| QA evidence            | `tests/e2e/custom-domain.spec.ts`; `tests/integration/custom-domains.test.ts`.                                                       |
| Launch disposition     | Deferred and clearly labeled (automatic part).                                                                                       |

### 27. Settings → Security: SSO and SCIM

| Field                  | Value                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Name / UI location     | Settings → Security (owners/admins, Enterprise plan).                                                                                            |
| Roadmap / priority     | Unmapped.                                                                                                                                        |
| Test result            | SCIM **Working** (list, add, deactivate, remove); SSO login page and "workspace requires SSO" **Working**; a real SAML sign-in **Not testable**. |
| External prerequisites | A SAML IdP test tenant (Okta/Azure AD) and Supabase SSO enabled on the project.                                                                  |
| QA evidence            | `tests/e2e/enterprise.spec.ts`; `tests/integration/sso-scim-privacy.test.ts`.                                                                    |
| Launch disposition     | Blocked until a test IdP is available.                                                                                                           |

### 28. Address suggestions (Google Places)

| Field                  | Value                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name / UI location     | Builder → Address question → "Suggest addresses as they type".                                                                                                                                          |
| Roadmap / priority     | #65 — Build Now.                                                                                                                                                                                        |
| UI claim               | Production: switch can't be turned on; "Address suggestions aren't set up on this site yet."                                                                                                            |
| Test result            | **Working** against the fake Places API: a suggestion fills the address, the key never reaches the browser, typing still works, forms without it get none. **Not testable**: Google billing and quotas. |
| External prerequisites | `GOOGLE_PLACES_API_KEY` with Places API (New) and billing.                                                                                                                                              |
| QA evidence            | `tests/e2e/features-49-68.spec.ts` (F-65 ×2).                                                                                                                                                           |
| Launch disposition     | Deferred and clearly labeled until the key exists.                                                                                                                                                      |

### 29. Email verification code

| Field                  | Value                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Name / UI location     | Builder → Email question → verify setting.                                                                                                      |
| Roadmap / priority     | #8 — Build Now — At the End (email first; SMS is never offered).                                                                                |
| UI claim               | Production: switch disabled with a note (no email provider).                                                                                    |
| Test result            | **Working** against the fake mailer: code sent and verified once, expiry, try limits, resend spacing and cap, dropped when codes can't be sent. |
| External prerequisites | `RESEND_API_KEY`, `EMAIL_FROM`.                                                                                                                 |
| QA evidence            | `tests/integration/email-codes.test.ts` (4); `tests/e2e/roadmap-v3.spec.ts`.                                                                    |
| Launch disposition     | Deferred and clearly labeled until Resend.                                                                                                      |

### 30. CAPTCHA (Cloudflare Turnstile)

| Field                  | Value                                                                                                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name / UI location     | Form → Settings → Spam protection → "Require a CAPTCHA to submit".                                                                                                                                                                     |
| Roadmap / priority     | #26 — Build Now.                                                                                                                                                                                                                       |
| UI claim               | Production: switch can't be turned on; hint says the bot check isn't set up on this site yet and the spam trap and rate limits still apply (IA-05).                                                                                    |
| Test result            | **Not testable**: no Turnstile keys locally or on production. The server check is unit-tested against a fake Cloudflare (`tests/unit/turnstile.test.ts`: fails closed without a token, without the secret, or when Cloudflare errors). |
| External prerequisites | `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` (Cloudflare account; Turnstile's published test keys can be used for a local smoke).                                                                                          |
| Launch disposition     | Deferred and clearly labeled until keys.                                                                                                                                                                                               |

### 31. AI (Edit with AI, response insights)

| Field              | Value                                                                         |
| ------------------ | ----------------------------------------------------------------------------- |
| Name / UI location | Builder "Edit with AI"; Responses → AI insights; Dashboard "Generate a form". |
| Roadmap / priority | #23 AI form editing, #30 advanced analytics — Build Now.                      |
| UI claim           | Production: "isn't set up on this site yet" (no `ANTHROPIC_API_KEY`).         |
| Test result        | **Working** against the fake Anthropic API. **Not testable**: the real model. |
| QA evidence        | `tests/e2e/ai.spec.ts`; `tests/integration/ai-insights.test.ts`.              |
| Launch disposition | Deferred and clearly labeled until the key.                                   |

### 32. Calendly / Cal.com on endings

Builder → Ending → "booking page" (Calendly or Cal.com link, checked to
be `https://calendly.com/…` or `https://cal.com/…`, embedded on the
ending). Unmapped (P2.16). No FormCraft-side account. **Working** for link
validation and prefill (`tests/unit/scheduler.test.ts`: only Calendly's and Cal.com's own hosts, over https); a real
Calendly page needs the customer's link. Verified active (local).

### 33. Import a form from a public link

Dashboard → Import (Google Forms and Typeform public links). #5 Build Now.
Reads public pages, no account. **Working** on recorded fixtures
(`tests/unit/form-import.test.ts`); live provider pages can change
markup, so a live smoke per release is advised. Verified active (local).

### Deferred connectors (Build Later) — checked absent

PayPal (#37), Microsoft 365 / Outlook / Teams / Excel connector (#39),
MSG91 / Twilio SMS (#41), WhatsApp Business (#42), Zendesk / Intercom
(#45) and custom SMTP (#57) appear **nowhere** in the UI: no card, tile,
setting or Connect button (a search of `src/` finds them only in
comments, the bot list and an email-client note). "Excel" appears only as
CSV/XLSX export. The unit test "only approved connectors are offered"
fails if one is added as an OAuth provider or app card. No customer data
or connection exists for them, so §J1.4's launch-blocker case doesn't
arise.

### Not in the customer UI

Sentry (errors) and PostHog (product analytics) are operator tools, not
customer integrations; production has neither key, so neither is
reporting. `CRON_SECRET` + Supabase scheduler drives retries for every
async connector above (fixed 2026-11-20).

---

## Owner decisions requested (§J6)

1. Payments (#22/#35) are live ahead of their final-phase slot: keep with
   a test-mode smoke, or hide until the final phase.
2. n8n (#49): is the signed webhook + guide enough, or is a published
   community node expected?
3. Unmapped live integrations — Google Sheets, Slack, HubSpot, data
   lookups, GA/GTM/Meta, Zapier/Make API, custom domains, SSO/SCIM,
   Calendly/Cal.com — need a priority in the register.
4. Zapier / Make: publish directory apps or stay API + webhook.
5. Outlook calendar under #27 (with #39 deferred).
6. Provider accounts for the real smokes: Google Cloud (Sheets, Calendar,
   Drive, Places; OAuth verification), Airtable, Salesforce, Notion,
   Mailchimp, Zoho (Multi-DC), Pipedrive OAuth apps, Resend with a
   verified domain, Turnstile, Anthropic, and test accounts for Stripe,
   Razorpay, HubSpot, Slack and each ad pixel.

## Test runs (20 November 2026, local)

All on the working tree with these fixes, local Supabase in Docker:

| Command                                                                                                                             | Result                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `npm run lint`                                                                                                                      | Pass                                                                                                   |
| `npm run typecheck`                                                                                                                 | Pass                                                                                                   |
| `npm run test` (unit)                                                                                                               | 86 files, 724 tests passed (incl. the new `tests/unit/integration-audit.test.ts`)                      |
| `npm run test:integration`                                                                                                          | 49 files, 289 tests passed (incl. the new `tests/integration/connectors-notion-zoho.test.ts`, 5 tests) |
| `npx playwright test` (chromium + mobile, `npm run build && npm run start` with the stand-in providers from `playwright.config.ts`) | 164 passed, 2 skipped (existing phone-only skips: lead-capture builder, shared blocks), 0 failed       |

The integration-relevant browser tests in that run: Airtable connect →
record → disconnect (`phase6`), Stripe and Razorpay payments (`payments`,
`phase7`), pixels and consent, embed SDK, registration PDF (`phase3`),
calendar without credentials (`phase5`, desktop and phone), Places
(`features-49-68` F-65), data lookups, public API for Zapier/Make, embed
allow-list, Razorpay key check, notification-rule email
(`creator-setup`), and the "isn't set up on this site yet" notes
(`qa-retest`).

Not run in this audit: any test against a real provider (no accounts;
see "Owner decisions requested" item 6).
