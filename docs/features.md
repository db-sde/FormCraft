# FormCraft — features built

A Typeform-style form builder. Everything below is built, tested
(unit, database and browser tests) and deployed at
<https://form-craft-ivory.vercel.app>, as of 12 November 2026.

Features marked **(needs setup)** are built but stay switched off, with a
friendly "almost here" note, until a key or account is added on the
server. See "Needs setup to go live" at the end.

---

## 1. Accounts, workspaces and teams

- Sign up, log in, log out, forgot / reset password, email confirmation
- Two-factor sign-in (authenticator app, recovery codes)
- Single sign-on (SAML) with an optional "require SSO" switch **(needs setup)**
- SCIM user provisioning from an identity provider
- Workspaces with a workspace switcher
- Team roles: owner, admin, editor, viewer; invite by email or link
- Granular permissions per member (manage integrations, etc.)
- Folders for organising forms
- Plans and usage limits (Free, Business…), set per workspace
- Audit log of who did what (Settings → Audit log)
- Data retention: auto-delete completed responses after N days
- Privacy requests: find, export and erase a person's responses
- Account deletion

## 2. Creating forms

- New form from a starter, a **blank form**, or one of 30 templates
- **Describe your form** with AI **(needs setup)**
- Import a form from a public Google Forms or Typeform link, with a report
- Duplicate, rename, delete; drafts autosave
- **Undo / redo** for every edit (buttons and Ctrl/Cmd+Z)
- Version history: see each published version and restore it to the draft
- Publish / unpublish; live edits go out only on republish
- Preview (desktop and phone) with a logic "why" trace
- Shared question blocks: a library of reusable questions with versions,
  locked copies and reviewed updates
- **Edit with AI**: describe a change, review it, apply or undo **(needs setup)**
- AI review of the form with suggested rewordings **(needs setup)**
- Checks before publishing (unfinished settings, starter wording)

## 3. Question types (26)

| Text and contact            | Choice          | Scales and dates    | Special                               |
| --------------------------- | --------------- | ------------------- | ------------------------------------- |
| Short text                  | Multiple choice | Rating (stars)      | File upload                           |
| Long text                   | Checkboxes      | Opinion scale / NPS | Signature (draw or type)              |
| Email                       | Dropdown        | Date                | Products (order with prices)          |
| Phone                       | Yes / No        | Time                | Booking (pick a time)                 |
| Website URL                 | Picture choice  | Date & time         | Matrix / grid                         |
| Number                      | Ranking         |                     | Address                               |
| Contact info (lead capture) |                 |                     | Statement, Welcome screen, Page break |

Per-question options include required, placeholder, length limits,
"Other" option, shuffled options, options carried from another question,
multiple answers, min / max, image, help text, default country (phone),
time windows and 12/24 h, and an optional AI follow-up question
**(needs setup)**.

## 4. Logic, scoring and quizzes

- Rules: "after this question, if … then go to / show ending / set a value"
- Show a question only when a condition holds
- Cross-field checks (e.g. end date after start date)
- Variables, formulas and scores; quiz scoring with correct answers
- Multiple endings, chosen by rules or by the highest score
- Recall answers and scores in later text ("Hi {{name}}")
- Hidden fields and UTM values from the link; prefill visible answers by link
- Random question groups ("ask 2 of 5") and shuffled order
- Adaptive assessments (next question harder or easier)
- Progressive profiling: skip what a visitor already answered on another form
- External data lookups: call your own API mid-form
- Logic map, checks for problems, and five logic templates
- Quiz answers and points are never sent to the respondent's browser

## 5. Design

- Themes and presets, colours, fonts (incl. uploaded fonts on paid plans)
- Button style, logo, background image
- Progress bar on / off
- Layouts: one question at a time, or classic pages (split by page breaks)
- Custom CSS, scoped to the form
- Multiple languages, with the right one picked per respondent
- Right-to-left text support
- FormCraft badge removable on paid plans

## 6. Sharing and access

- Public link, custom link slug, QR code on the Share page
- Embeds: inline, popup, slide-in, side tab, full page, button; delay and
  scroll triggers; an embed allowlist (only listed sites may embed)
- Custom domains (forms on your own domain) **(needs setup for automatic HTTPS)**
- Password-protected forms
- Close date and response limit, each with its own message
- Bot protection: hidden spam trap, rate limits, optional CAPTCHA **(needs setup)**
- Kiosk mode (one device, many people, exit PIN)
- Finish later: resume links
- A/B tests: between two forms, or between variants inside one form

## 7. The respondent's experience

- Mobile-first, keyboard-friendly and screen-reader friendly
- Answers saved as they go (unfinished responses kept, if the form allows)
- Server checks every answer; friendly per-question error messages
- Redirect after submit (with delay), or custom endings
- Payment step at the end (see Payments)
- Booking a time slot inside the form
- Confirmation email to the respondent **(needs setup)**

## 8. Responses and results

- Responses table: completed and unfinished, search, filters, score columns,
  file links, pages of results
- Response detail: every answer, files, signature, timeline of what happened
  (emails, webhooks, payments, team actions), replay a failed sync
- Review status, assignee and private comments on each response
- Summary: per-question charts, drop-off, conversion insights, sources,
  NPS with trend, endings reached, score stats
- Cross-tabs (compare two questions) with CSV
- Leads list across all forms, with CSV
- Export to CSV and Excel (safe against spreadsheet formula injection),
  incl. deleted questions' answers and file links
- PDF documents per response: summary, order, registration, certificate
- Confidential 360° feedback reports (groups only, no individual answers)
- AI insights: summaries, tags, sentiment, lead scores **(needs setup)**
- Views, starts, completions and completion rate

## 9. Notifications

- Email to the form owner on each response **(needs setup)**
- Notification rules: email teammates when answers match, with the PDF
- Daily or weekly digest emails **(needs setup)**
- Slack messages per response

## 10. Integrations

- Webhooks (signed, retried, with delivery log)
- Google Sheets (a row per response) **(needs setup)**
- HubSpot (contacts)
- Airtable, Salesforce, Notion, Mailchimp, Zoho CRM, Pipedrive **(needs setup)**
- Zapier / Make through the public API and API keys
- Google Analytics, Tag Manager, Meta, LinkedIn and TikTok pixels, with a
  consent prompt and Global Privacy Control
- Public REST API (`/api/v1`) with scoped API keys

## 11. Bookings

- Booking types: hours, buffers, notice, durations, team hosts
- Booking question in forms; slots held safely so no double-booking
- Manage / cancel links for attendees, reminders
- Google Calendar sync per host **(needs setup)**

## 12. Payments

- Take a payment on submit: fixed amount, calculated amount, or the
  Products order total
- Razorpay (INR: cards, UPI, netbanking) and Stripe, connected per workspace
- Coupons (percent or amount off, limits, expiry)
- Pay later link, receipts, refunds recorded, one paid state even with
  duplicate webhooks
- When a form doesn't charge, the builder and respondent are told so

## 13. Security and reliability (behind the scenes)

- Row-level security on every table; workspaces fully separated
- Published versions are immutable; responses keep the version they used
- A response can only be changed from the browser that started it
- Rate limits that hold even when requests come from changing addresses
- Strong security headers (CSP, HSTS); no open redirects
- Encrypted integration secrets with key rotation
- Background jobs every minute (retries, digests, reminders, cleanup)
- Error tracking (Sentry) **(needs setup)** and product analytics (PostHog)
- Secret scanning and dependency updates in CI

---

## Needs setup to go live

| To switch on                                             | Add on the server (Vercel)                                           |
| -------------------------------------------------------- | -------------------------------------------------------------------- |
| All emails (owner, respondent, invites, digests)         | `RESEND_API_KEY`, `EMAIL_FROM` (and a verified domain in Resend)     |
| AI features                                              | `ANTHROPIC_API_KEY`                                                  |
| Google Sheets and Google Calendar                        | Google OAuth client id / secret                                      |
| Airtable, Salesforce, Notion, Mailchimp, Zoho, Pipedrive | That app's OAuth client id / secret                                  |
| CAPTCHA                                                  | Cloudflare Turnstile site key and secret                             |
| Automatic HTTPS for custom domains                       | `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`                              |
| Error tracking                                           | `NEXT_PUBLIC_SENTRY_DSN`                                             |
| Single sign-on                                           | An identity provider, set up in Supabase                             |
| Payments                                                 | Each workspace connects Razorpay or Stripe in Settings → Connections |

## Not built (deferred on purpose)

Workflow / approval engine, headless React SDK, email / SMS OTP
verification, public JSON schema export, offline collection, native
mobile apps, video / audio answers, field-level encryption and data
residency, PayPal, Microsoft 365, SMS providers, WhatsApp, Zendesk /
Intercom, and recurring subscriptions.
