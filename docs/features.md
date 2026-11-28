# FormCraft — features built

A Typeform-style form builder with plans and checkout. Everything below is
built, tested (unit, database and browser tests) and deployed at
<https://form-craft-ivory.vercel.app>, as of 27 November 2026.

Paid features name the plan they start on (Starter, Pro or Business);
everything else is on every plan, Free included. Features marked
**(needs setup)** are built but stay off, with a "not set up yet" note,
until a key is added on the server. See "Needs setup to go live" at the
end. `docs/integration-audit.md` lists every connection with its test
evidence.

---

## 1. Accounts, workspaces and teams

- Sign up, log in, log out, forgot / reset password, email confirmation
- Two-factor sign-in (authenticator app, recovery codes)
- Single sign-on (SAML) with an optional "require SSO" switch (Business)
  **(needs setup)**
- SCIM user provisioning from an identity provider (Business)
- Workspaces with a workspace switcher
- Team roles: owner, admin, editor, viewer; invite by email or link
- Per-member permissions: see responses, export, publish, manage
  integrations, correct answers
- Folders for organising forms (Starter)
- Audit log with the reason, the outcome and the request it came from
  (Business; support access is visible on every plan)
- Data retention: auto-delete responses after N days (Business)
- Privacy requests: find, export and erase a person's responses
- Account deletion

## 2. Plans, pricing and checkout

Four public plans on `/pricing` (yearly and monthly), plus Enterprise for
custom contracts (not listed). Forms and responses are unlimited on every
plan: the response number is a fair-use level, never a cap.

|                                  | Free             | Starter              | Pro                    | Business                |
| -------------------------------- | ---------------- | -------------------- | ---------------------- | ----------------------- |
| Price, yearly (per month)        | $0               | $15 / ₹1,299         | $39 / ₹3,299           | $69 / ₹5,899            |
| Price, monthly                   | $0               | $19 / ₹1,599         | $49 / ₹4,199           | $89 / ₹7,599            |
| Responses (fair use)             | 5,000            | 10,000               | 25,000                 | 50,000                  |
| Seats                            | 1                | 3                    | 10                     | Unlimited               |
| File storage                     | 1 GB             | 10 GB                | 50 GB                  | 200 GB                  |
| Custom domains                   | 0                | 1                    | 3                      | Unlimited               |
| AI credits / month               | 0                | 100                  | 1,000                  | 2,000                   |
| Emails / month                   | 500              | 2,000                | 10,000                 | 25,000                  |
| Address suggestions / month      | 0                | 500                  | 2,000                  | 2,500                   |
| API per minute / burst / per day | 60 / 100 / 5,000 | 150 / 1,000 / 50,000 | 300 / 10,000 / 250,000 | 1,000 / 50,000 / no cap |
| API keys                         | 2                | 5                    | 25                     | Unlimited               |
| Video and audio answers          | 1 min            | 3 min                | 10 min                 | 10 min                  |

- Plan limits come from one file (`src/domains/billing/catalog.ts`) that
  drives the app, the API, the database seed and the pricing page
- Paid features are checked on the server for every action, and again
  when a form is published
- When an allowance runs out nothing is lost: owner emails become one
  daily summary, address fields fall back to typing, AI pauses, new
  uploads stop with a clear message
- AI credits by model: Haiku 1, Sonnet 5, Opus 10
- Usage meters and warnings in Settings → Plan
- Checkout: subscriptions by card in US dollars (Stripe) or by UPI or
  card in rupees (Razorpay), monthly or yearly **(needs setup)**
- Change plan, cancel at the end of the period (then Free, data kept),
  cards and invoices through Stripe's portal
- The plan changes only when Stripe or Razorpay confirms the payment;
  each provider event is applied once
- Until billing keys are set, owners send an upgrade request that staff
  handle in the admin portal

## 3. Creating and managing forms

- New form from a starter, a blank form, or one of 30 templates
- Save any form as a template, private or for the workspace
- **Describe your form** with AI (Starter) **(needs setup)**
- Import a form from a public Google Forms or Typeform link, with a report
- Duplicate, rename, delete; drafts autosave
- Undo / redo for every edit (buttons and Ctrl/Cmd+Z)
- Version history: see each published version and restore it to the draft
- Publish / unpublish; edits go live only when you publish again
- Preview (desktop and phone) with a logic "why" trace
- Build and publish from a phone browser
- Shared question blocks with versions and reviewed updates (Pro)
- **Edit with AI** and an AI review of the form (Starter) **(needs setup)**
- Checks before publishing, including paid features the plan lacks
- Archiving: from the form's menu, the builder's Settings, a bulk
  selection or the API. An archived form is unpublished, its link,
  custom domain, embed and resume links answer "no longer available"
  (HTTP 410, noindex), queued deliveries are cancelled with a reason on
  each response's timeline, A/B tests stop, and upcoming bookings must be
  kept or cancelled first. Restore brings it back unpublished with the
  same slug, responses and settings

## 4. Question types (30)

| Text and contact            | Choice          | Scales and dates    | Special                               |
| --------------------------- | --------------- | ------------------- | ------------------------------------- |
| Short text                  | Multiple choice | Rating (stars)      | File upload                           |
| Long text                   | Checkboxes      | Opinion scale / NPS | Signature (draw or type)              |
| Email                       | Dropdown        | Date                | Products (order with prices)          |
| Phone                       | Yes / No        | Time                | Booking (pick a time)                 |
| Website URL                 | Picture choice  | Date & time         | Matrix / grid                         |
| Number                      | Ranking         | Date range          | Address                               |
| Contact info (lead capture) |                 |                     | Video or audio answer                 |
| Repeating group             |                 |                     | Consent page                          |
|                             |                 |                     | Statement, Welcome screen, Page break |

Per-question options include required, placeholder, length limits,
"Other" option, shuffled options, options carried from another question,
multiple answers, min / max, image, help text, default country (phone),
time windows and 12/24 h, an optional AI follow-up question **(needs
setup)**, "Report as NPS" for a 0–10 scale, and the kind of notice on
consent pages.

## 5. Logic, scoring and quizzes

- Rules: "after this question, if … then go to / show ending / set a value"
- Show a question only when a condition holds
- Cross-field checks (e.g. end date after start date)
- Variables, formulas and scores; quiz scoring with correct answers
- Multiple endings, chosen by rules or by the highest score
- Recall answers and scores in later text ("Hi {{name}}")
- Hidden fields and UTM values from the link; prefill visible answers by
  link (they steer logic, never prices or access)
- Random question groups ("ask 2 of 5") and shuffled order (Pro)
- Adaptive assessments (next question harder or easier)
- Progressive profiling: skip what a visitor already answered (Pro)
- External data lookups: call your own API mid-form (Pro)
- Logic map, checks for problems, and five logic templates
- Quiz answers and points are never sent to the respondent's browser

## 6. Design: themes, fonts and layouts

- 66 themes in eight groups (Minimal, Bold, Dark, Soft, Corporate,
  Playful, Seasonal, Industry), each passing 4.5:1 contrast for text and
  buttons; a larger preview on hover or tap; applying one copies its
  values, so later preset changes never alter a form
- Workspace brand themes: save your own look and reuse it
- Font library of 1,959 open-licensed families, searchable by style and
  script, with only fonts that can write the form's languages offered;
  served from FormCraft's `/fonts` routes so respondents never contact
  Google; the catalogue refreshes monthly
- Separate heading and body fonts with heading weight (at most two
  families and four font files per form)
- Uploaded fonts (Starter)
- Colours with a contrast warning and one-click fix, background gradient,
  corner radius, spacing, button style, logo, background image
- Progress bar, with optional words: 40% complete, Question 3 of 8,
  5 questions left
- Layouts: one question at a time, or classic pages (split by page breaks)
- Custom CSS, scoped to the form (Starter)
- Link themes: a saved look or a built-in theme with `?theme=` on the
  link or embed (Pro)
- Multiple languages, picked per respondent; right-to-left text
- FormCraft badge removable (Starter)

## 7. Sharing, access and link previews

- Public link, custom link slug, QR code on the Share page
- Embeds: inline, popup, slide-in, side tab, full page, button; delay and
  scroll triggers; an embed allowlist (Pro)
- Custom domains (Starter) **(needs setup for automatic HTTPS)**
- Password-protected forms
- Close date and response limit, each with its own message
- Bot protection: hidden spam trap, rate limits, optional CAPTCHA
  **(needs setup)**
- Kiosk mode (one device, many people, exit PIN)
- Finish later: resume links
- A/B tests: between two forms, or between variants inside one form (Pro)
- Link preview and SEO (Starter): share title (counter at 60, up to 70),
  description (counter at 155, up to 200), a share image cropped to
  1200 × 630 and re-encoded on the server (EXIF and location dropped),
  and a tab icon; preview cards for WhatsApp, LinkedIn and X. Settings
  go live on publish. Free gets an automatic card made at publish with
  the FormCraft badge
- Search indexing off unless turned on; indexed forms are listed in
  `sitemap.xml`. Canonical and `og:url` use the custom domain when there
  is one. Password-protected, closed and archived forms are always
  noindex and show no question text

## 8. The respondent's experience

- Mobile-first, keyboard-friendly and screen-reader friendly
- Answers saved as they go (unfinished responses kept, Starter)
- Moving on after a single choice: per form and per question
- A review of every answer before submitting, with Edit
- Address suggestions as they type (Starter) **(needs setup)**
- Server checks every answer; friendly per-question error messages
- Record a video or audio answer in the browser, with playback and
  re-record
- Confirm an email address with a 6-digit code (Pro) **(needs setup:
  email)**
- Redirect after submit (with delay), or custom endings
- Payment step and booking a time slot inside the form
- Confirmation email to the respondent (Starter) **(needs setup)**

## 9. Responses and results

- Responses table: completed and unfinished, search, filters, score
  columns, file links
- Response detail: every answer, files, signature, timeline of what
  happened (emails, webhooks, payments, team actions), replay a failed sync
- Review status, assignee and private comments (Pro)
- Correct a submitted answer with a reason; the original and every
  correction are kept (Pro)
- Play video and audio answers
- Summary: per-question charts, drop-off, conversion insights, sources,
  NPS with trend, endings reached, score stats (Starter)
- Cross-tabs (compare two questions) with CSV (Pro)
- Leads list across all forms, with CSV (Pro)
- Export to CSV and Excel (safe against spreadsheet formula injection)
- PDF documents per response: summary, order, registration, certificate
  (Starter)
- Confidential 360° feedback reports, by group only (Pro)
- AI insights: summaries, tags, sentiment, lead scores (Pro)
  **(needs setup)**
- Views, starts, completions and completion rate

## 10. Notifications and custom email templates

- Email to the form owner on each response **(needs setup)**; the
  standard email keeps answers out
- Notification rules: email teammates when answers match, with the PDF
  (Pro)
- Daily or weekly digest emails (Pro) **(needs setup)**
- Slack messages per response
- Email branding: logo, button colour, footer, sender name (Starter)
- Custom email templates (Starter) for the respondent confirmation, owner
  notification, notification-rule emails, and booking confirmation and
  reminder:
  - Subject (150), preview line (120), sender name (60) and reply-to
    (the owner, a fixed address, or the answer to an Email question,
    falling back to the owner when it isn't an address)
  - Body blocks: text (bold, italic, links, lists), heading, image,
    button, divider, all-answers table, spacer
  - Merge tags from a picker, with fallbacks: `{{answer:q1 | "there"}}`
  - Live preview with the latest response, test sends to yourself
    (10 an hour, not counted), saved workspace templates, reset to default
  - Answers are escaped into place, so they never become markup or
    links; line breaks are stripped from the subject, sender and reply-to
  - Table-based HTML and a plain-text version; a footer naming the sender
  - A snapshot of each form's templates is kept with every publish

## 11. Integrations and the public API

- Webhooks (signed, retried, with a delivery log); events for unfinished
  responses (answers saved, abandoned, resumed, Starter)
- n8n: send responses to an n8n workflow, with a sample
- Google Sheets (a row per response) **(needs setup)**
- Google Drive: uploaded files copied to a folder (Starter)
  **(needs setup)**
- HubSpot, Airtable, Notion, Mailchimp (Starter); Salesforce, Zoho CRM,
  Pipedrive (Pro) **(needs setup, except HubSpot)**
- Zapier / Make through the public API and API keys
- Google Analytics, Tag Manager, Meta (Starter); LinkedIn and TikTok
  pixels (Pro); with a consent prompt and Global Privacy Control
- Public REST API (`/api/v1`) on every plan: forms (`?archived=` filter),
  responses, subscriptions, archive and restore
- Scoped API keys (read forms, change forms, read responses, subscribe),
  shown once and stored hashed; at most 10 new keys an hour
- Rate limits per workspace across all its keys: a token bucket and a
  daily count (UTC), held in Postgres so every server agrees;
  `X-RateLimit-*` headers on every response; 429 with `Retry-After` and
  `{"error":"rate_limited","scope":"minute|day","retry_after":N}`
- Settings → API: usage for 24 hours and 30 days, current limits, the
  last refusal; the owner is emailed the first time each day the cap is hit
- `/developers` page with the endpoints and the limits table

## 12. Bookings

- Booking types: hours, buffers, notice, durations (one on Free)
- Team hosts (Pro)
- Booking question in forms; slots held safely so no double-booking
- Manage / cancel links for attendees, reminders
- Google Calendar sync per host (Starter) **(needs setup)**

## 13. Payments on forms

- Take a payment on submit: fixed amount, calculated amount, or the
  Products order total
- Razorpay (INR: cards, UPI, netbanking) and Stripe, connected per
  workspace; 0% FormCraft fee
- Coupons (percent or amount off, limits, expiry)
- Pay later link, receipts, refunds recorded, one paid state even with
  duplicate webhooks
- Payments still pending after 15 minutes are checked with Stripe /
  Razorpay directly

## 14. Super Admin portal (FormCraft staff)

A separate, staff-only deployment: two-factor sign-in, every action
checked in the database and logged, high-risk changes approved by a
second person.

- Customers: search, detail, suspend / restore, open upgrade requests
- Plans: change a workspace's plan or limits through an approved request
- Usage: active users and workspaces, sign-ups and submissions, feature
  adoption, heaviest workspaces, over-fair-use flags
- Forms inventory
- Operations: webhook health, scheduler, backups and restore tests,
  drills, alerts, and feature switches (turn archiving, SEO, the API on
  Free, the font library, email templates or checkout off for everyone or
  one workspace, with a reason)
- AI: gateway settings, model per feature, cost per workspace, a daily
  ceiling, one-click pause
- Privacy requests and retention runs
- Customer messages: incident, billing, policy and service notices
- Staff management, monthly access reviews, approvals, staff audit log

## 15. Security, privacy and reliability

- Hosted on SOC 2 audited infrastructure (Vercel, Supabase); FormCraft
  has not completed its own SOC 2 audit. `npm run check:claims` fails CI
  on any other wording or a SOC logo
- `/security` and `/legal/subprocessors` pages
- Row-level security on every table; workspaces fully separated; second
  factor enforced in the database
- Published versions are immutable; responses keep the version they used
- A response can only be changed from the browser that started it
- Rate limits that hold across servers and changing addresses
- Strong security headers (CSP, HSTS); no open redirects
- Encrypted integration secrets with key rotation
- Background jobs on a schedule: webhook, Sheets and app deliveries and
  their retries every minute; digests hourly; payment checks every 15
  minutes; operations checks every 5 minutes; clean-up daily
- Every request has an id, carried into error logs, audit entries and
  analytics; a recovery runbook for payments, deliveries and usage
- Error tracking (Sentry) and product analytics (PostHog) **(needs setup)**
- Secret scanning, dependency updates and a security scan in CI

---

## Needs setup to go live

| To switch on                                             | Add on the server (Vercel)                                                                                                        |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Checkout in US dollars (Stripe)                          | `STRIPE_BILLING_SECRET_KEY`, `STRIPE_BILLING_WEBHOOK_SECRET`; a webhook to `/api/billing/stripe`; Stripe's customer portal on     |
| Checkout in rupees (Razorpay)                            | `RAZORPAY_BILLING_KEY_ID`, `RAZORPAY_BILLING_KEY_SECRET`, `RAZORPAY_BILLING_WEBHOOK_SECRET`; a webhook to `/api/billing/razorpay` |
| All emails (owner, respondent, invites, digests)         | `RESEND_API_KEY`, `EMAIL_FROM` (and a verified domain in Resend)                                                                  |
| AI features                                              | `ANTHROPIC_API_KEY`                                                                                                               |
| Google Sheets, Calendar and Drive                        | Google OAuth client id / secret (Drive API enabled for Drive)                                                                     |
| Address suggestions                                      | `GOOGLE_PLACES_API_KEY` (Places API (New))                                                                                        |
| Airtable, Salesforce, Notion, Mailchimp, Zoho, Pipedrive | That app's OAuth client id / secret                                                                                               |
| CAPTCHA                                                  | Cloudflare Turnstile site key and secret                                                                                          |
| Automatic HTTPS for custom domains                       | `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`                                                                                           |
| Error tracking                                           | `NEXT_PUBLIC_SENTRY_DSN`                                                                                                          |
| Product analytics                                        | `NEXT_PUBLIC_POSTHOG_KEY`, `POSTHOG_SERVER_API_KEY`                                                                               |
| Single sign-on                                           | An identity provider, set up in Supabase                                                                                          |
| Payments on forms                                        | Each workspace connects Razorpay or Stripe in Settings → Connections                                                              |

## Not built yet

- Tax (GST / VAT) collection at checkout: needs the business's
  registrations first
- More than one workspace per account (not sold on the pricing page)
- Moving file storage to Cloudflare R2
- `/enterprise`, comparison pages and a help centre
- Picture previews of every font in the picker (the chosen font is
  previewed)
- Deferred on purpose: workflow / approval engine, headless React SDK, SMS
  codes, public JSON schema export, offline collection, native mobile
  apps, field-level encryption and data residency, PayPal, Microsoft 365,
  WhatsApp, Zendesk / Intercom, custom SMTP, fillable PDF mapping, an AI
  landing-page builder
