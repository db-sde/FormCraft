# FormCraft — Developer-Ready Master Specification

**Source baseline:** _FormCraft Competitive Gap Report_ (October 28, 2026, nine pages) plus the 48 explicit user decisions and elaborations made in the review conversation.
**Document type:** implementation brief and acceptance checklist; not a statement that the features have already been built.
**Version:** 1.0 | **Decision coverage:** 48/48 | **Roadmap categories:** 33 Build Now; 2 Build Now — At the End; 13 Build Later; 0 Skip.

> **Reading convention:** **[REPORT]** describes existing code and identified gaps as represented in the uploaded PDF. **[DECIDED]** is an approved priority/scope from the questionnaire. **[PROPOSED]** is engineering detail or sequencing to make implementation testable; it must not silently override a user decision. All estimates remain to be validated by the engineering team.

## 1. Executive brief

Deliver 35 approved feature entries during the current roadmap, of which **33 are ordinary Build Now entries and 2 are deliberately scheduled at the end**. There are **34 distinct current engineering workstreams**, because **#22 Payments and #35 Razorpay/UPI are the same work package**. In addition, **#43 Google Calendar is a sub-workstream of #27 Native Booking** rather than a second scheduling engine. Therefore a contractor should estimate effort by work package, not by raw feature-row count.

**Source baseline [REPORT]:** FormCraft already has a conversational form renderer, strong conditional logic, partial responses, analytics, REST API, Stripe Checkout after submit, Google Sheets/HubSpot/Slack integrations, a webhook/retry system, and SSO/role management. The report is a code review, not a running-app verification, and notes some integrations have not been exercised against live accounts. Do **not** rebuild these existing capabilities or call them newly requested features.

### 1.1 Governing rules

1. **User decisions are the scope authority.** Preserve the distinctions between Build Now, Build Now — At the End, and Build Later.
2. **Avoid duplicate builds:** #22/#35 = a single payments/Razorpay epic; #27/#43 = native booking plus its Google Calendar connector.
3. **Preserve existing platform behavior:** no regression in conditional logic, scoring, resume links, UTM/referrer, conversion analytics, current embeds, existing payment provider, permissions or signed webhooks.
4. **No silent publishing or destructive AI changes:** imported forms remain draft, and AI edits must be reviewed and approved.
5. **No security or regulatory overclaiming:** a signature drawing is not a certified signature platform; shared form passwords are not user identity; HIPAA/certification initiatives are deferred; PDFs are not automatically tax-compliant invoices.
6. **Acceptance criteria describe observable outcomes.** Each current feature must satisfy its detailed entry and cross-cutting release gates below.

## 2. Complete decision register (source order)

|   # | Feature                                    | Priority                   | Planned phase  |
| --: | ------------------------------------------ | -------------------------- | -------------- |
|   1 | Classic multi-question layout              | **Build Now**              | P1             |
|   2 | Workflow and approval engine               | **Build Later**            | Future backlog |
|   3 | Records view / response management         | **Build Now**              | P2             |
|   4 | Product / order block                      | **Build Now**              | P2             |
|   5 | Advanced public-link form import           | **Build Now**              | P2             |
|   6 | Headless SDK / React renderer              | **Build Later**            | Future backlog |
|   7 | PDF / document generation                  | **Build Now**              | P3             |
|   8 | Email / SMS OTP verification               | **Build Later**            | Future backlog |
|   9 | Reusable governed question blocks          | **Build Now**              | P1             |
|  10 | Basic e-signature field                    | **Build Now**              | P2             |
|  11 | Matrix / grid question                     | **Build Now**              | P1             |
|  12 | Picture choice                             | **Build Now**              | P1             |
|  13 | Address field                              | **Build Now**              | P1             |
|  14 | Custom CSS                                 | **Build Now**              | P1             |
|  15 | Kiosk mode                                 | **Build Now**              | P1             |
|  16 | Open JSON form-schema export               | **Build Later**            | Future backlog |
|  17 | Offline collection                         | **Build Later**            | Future backlog |
|  18 | Ranking question                           | **Build Now**              | P1             |
|  19 | Native Android / iOS app                   | **Build Later**            | Future backlog |
|  20 | Time and date-time fields                  | **Build Now**              | P1             |
|  21 | Video / audio answers                      | **Build Later**            | Future backlog |
|  22 | Payments enhancement                       | **Build Now — At the End** | P7             |
|  23 | AI form editing                            | **Build Now**              | P4             |
|  24 | Advanced embed modes                       | **Build Now**              | P3             |
|  25 | Advanced email notifications               | **Build Now**              | P3             |
|  26 | CAPTCHA / bot protection                   | **Build Now**              | P0             |
|  27 | Fully native booking system                | **Build Now**              | P5             |
|  28 | Visible-answer URL prefill                 | **Build Now**              | P1             |
|  29 | Advanced in-form A/B testing               | **Build Now**              | P4             |
|  30 | Advanced survey analytics                  | **Build Now**              | P4             |
|  31 | Per-response observability timeline        | **Build Now**              | P2             |
|  32 | Compliance and privacy expansion           | **Build Later**            | Future backlog |
|  33 | Airtable integration                       | **Build Now**              | P6             |
|  34 | Salesforce integration                     | **Build Now**              | P6             |
|  35 | Razorpay / UPI integration                 | **Build Now — At the End** | P7             |
|  36 | Notion integration                         | **Build Now**              | P6             |
|  37 | PayPal integration                         | **Build Later**            | Future backlog |
|  38 | Mailchimp integration                      | **Build Now**              | P6             |
|  39 | Microsoft 365 integration suite            | **Build Later**            | Future backlog |
|  40 | Zoho CRM and Pipedrive integrations        | **Build Now**              | P6             |
|  41 | SMS provider (MSG91 / Twilio)              | **Build Later**            | Future backlog |
|  42 | WhatsApp integration                       | **Build Later**            | Future backlog |
|  43 | Google Calendar native booking integration | **Build Now**              | P5             |
|  44 | LinkedIn Insight Tag / TikTok Pixel        | **Build Now**              | P3             |
|  45 | Zendesk and Intercom                       | **Build Later**            | Future backlog |
|  46 | Scheduled form close date                  | **Build Now**              | P0             |
|  47 | Response cap per form                      | **Build Now**              | P0             |
|  48 | Password-protected forms                   | **Build Now**              | P0             |

### 2.1 Decision reconciliation and overlap policy

- **#32 Compliance and Privacy:** user revised priority from Build Now to **Build Later**. Existing data-protection duties remain in force.
- **#22 / #35:** both explicitly **Build Now — At the End**. Include Razorpay/UPI in the payments epic. PayPal (#37) and subscriptions remain **Build Later**.
- **#27 / #43:** fully **native** booking was explicitly chosen over embedded Calendly/Cal.com. Google Calendar is **Build Now** as part of booking.
- **#27 versus #39:** the accepted #27 requirements included Outlook calendar synchronization, but the later decision deferred the wider **Microsoft 365 (Excel/Teams/Outlook)** suite (#39). **PROPOSED reconciliation:** keep a narrowly scoped Outlook-calendar connector under #27 _only if the owner explicitly confirms it_; do not silently expand the deferred M365 suite. In the meantime the implementation can release native booking with Google Calendar and an internal calendar; mark Outlook as a release-scope decision.
- **#7 versus #22:** build PDF summary/certificate/registration and unpaid order confirmations before the payments phase; activate verified paid receipts only with payments.
- **#8/#41/#42:** OTP, SMS gateways and WhatsApp are all deferred. Do not assume SMS/WhatsApp for booking reminders; use existing email capabilities initially.
- **#16:** JSON schema export is deferred even though advanced import (#5) is now. It is not a prerequisite for public-link ingestion.

## 3. Phased implementation plan

**Sequencing status:** All phase numbers are **[PROPOSED] engineering order**, not additional user choices. There is no approved calendar schedule or staffing estimate. A reasonable execution approach is to run small independent epics in parallel after shared schema/security contracts are agreed.

### Phase 0 — Security, access and submission guardrails

Stabilize server-side authorization, form availability and anti-abuse before expanding surface area. Includes infrastructure needed across future phases.

**Included features:** #26 CAPTCHA / bot protection, #46 Scheduled form close date, #47 Response cap per form, #48 Password-protected forms.

**Exit gate:** Every item in this phase passes its acceptance criteria, automated regressions, required role/security checks and production-ready observability; downstream dependencies documented before the next phase.

### Phase 1 — Form authoring and question types

Deliver a more complete authoring system and ensure the shared schema and logic engine work across all question types and layouts.

**Included features:** #1 Classic multi-question layout, #9 Reusable governed question blocks, #11 Matrix / grid question, #12 Picture choice, #13 Address field, #14 Custom CSS, #15 Kiosk mode, #18 Ranking question, #20 Time and date-time fields, #28 Visible-answer URL prefill.

**Exit gate:** Every item in this phase passes its acceptance criteria, automated regressions, required role/security checks and production-ready observability; downstream dependencies documented before the next phase.

### Phase 2 — Records, data models and portability

Make responses actionable and portable, and build the dependable lifecycle events that every follow-on integration requires.

**Included features:** #3 Records view / response management, #4 Product / order block, #5 Advanced public-link form import, #10 Basic e-signature field, #31 Per-response observability timeline.

**Exit gate:** Every item in this phase passes its acceptance criteria, automated regressions, required role/security checks and production-ready observability; downstream dependencies documented before the next phase.

### Phase 3 — Distribution, communication and documents

Support distribution, delivery and high-quality generated documents across channels.

**Included features:** #7 PDF / document generation, #24 Advanced embed modes, #25 Advanced email notifications, #44 LinkedIn Insight Tag / TikTok Pixel.

**Exit gate:** Every item in this phase passes its acceptance criteria, automated regressions, required role/security checks and production-ready observability; downstream dependencies documented before the next phase.

### Phase 4 — Intelligence and analytics

Add AI-assisted editing, controlled experimentation and richer analysis after data semantics are stable.

**Included features:** #23 AI form editing, #29 Advanced in-form A/B testing, #30 Advanced survey analytics.

**Exit gate:** Every item in this phase passes its acceptance criteria, automated regressions, required role/security checks and production-ready observability; downstream dependencies documented before the next phase.

### Phase 5 — Native bookings and calendars

Deliver an actual FormCraft scheduling product with atomic slots and Google Calendar synchronization.

**Included features:** #27 Fully native booking system, #43 Google Calendar native booking integration.

**Exit gate:** Every item in this phase passes its acceptance criteria, automated regressions, required role/security checks and production-ready observability; downstream dependencies documented before the next phase.

### Phase 6 — Business integrations

Scale the integration catalog using a common, observable connector platform; do not build one-off logging and retry for each connector.

**Included features:** #33 Airtable integration, #34 Salesforce integration, #36 Notion integration, #38 Mailchimp integration, #40 Zoho CRM and Pipedrive integrations.

**Exit gate:** Every item in this phase passes its acceptance criteria, automated regressions, required role/security checks and production-ready observability; downstream dependencies documented before the next phase.

### Final phase — Payments and Razorpay / UPI

Build order/payment flows last as requested, treating Feature 22 and 35 as one payment workstream.

**Included features:** #22 Payments enhancement, #35 Razorpay / UPI integration.

**Exit gate:** Every item in this phase passes its acceptance criteria, automated regressions, required role/security checks and production-ready observability; downstream dependencies documented before the next phase.

## 4. Detailed implementation cards — all 48 decisions

For each card, the **scope** reflects agreed behavior where explicitly discussed; the **acceptance criteria** are actionable **[PROPOSED] engineering interpretations** of that behavior. Defer cards are recorded for backlog preservation and are **not** authorization to implement them in the current cycle.

### F-01 — Classic multi-question layout

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P1 | **Report location:** p. 7

**Scope:** Render multiple questions per page, with sections and multiple pages alongside the current conversational renderer.

**Acceptance criteria / future design gate:** Creator selects conversational or classic layout; can group/reorder questions and pages; existing conditional logic, validation, progress, save/resume and scoring work in both; keyboard, mobile and back-navigation tests pass.

**Dependencies and non-goals:** Schema migration and renderer abstraction; share logic engine.

### F-02 — Workflow and approval engine

**Decision [DECIDED]:** BUILD LATER \
**Phase:** Future backlog | **Report location:** p. 2

**Scope:** Multi-stage approval, approver assignment and task workflow.

**Acceptance criteria / future design gate:** Future: assign stages, track approvals, handle escalations and audit events.

**Dependencies and non-goals:** Depends on Records View and identity/permissions.

### F-03 — Records view / response management

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P2 | **Report location:** p. 2

**Scope:** Response workspace with statuses, assignees, private comments, searching and filters; optional Kanban after list-view MVP.

**Acceptance criteria / future design gate:** Authorized users can change response status and assignee, add timestamped internal comments and filter by both; changes are permission-checked/audited; comments are not exposed to respondents; CSV/Excel export does not leak private data.

**Dependencies and non-goals:** Depends on current Leads/responses model; integrates Feature 31.

### F-04 — Product / order block

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P2 | **Report location:** p. 2

**Scope:** Product catalog items with image, title, price, quantity, and calculated totals.

**Acceptance criteria / future design gate:** Creator can add/remove catalog items and image; respondent selects items/quantities; totals recalculate safely including boundary conditions; server recomputes authoritative totals; currency and rounding are consistent; order is saved with response.

**Dependencies and non-goals:** Feature 22/35 payment processing and 7 documents consume order records.

### F-05 — Advanced public-link form import

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P2 | **Report location:** p. 2

**Scope:** Google Forms and Typeform first, from publicly accessible form URLs; no account connection by default. Reconstruct questions/options/required states and recoverable logic, validation, layout and styling. Flag missing/uncertain elements. Draft-only import; creator review + manual publish; no historical responses.

**Acceptance criteria / future design gate:** Public URL accepted for supported sources; importer never claims inaccessible logic was recovered; field-level import report distinguishes imported/converted/unknown; unsupported source/private URL gives actionable message; imported form stays unpublished until reviewed and explicitly published; no existing submissions imported.

**Dependencies and non-goals:** Source-specific parsers; shared canonical schema; test representative public forms, unsupported widgets and hidden branches.

### F-06 — Headless SDK / React renderer

**Decision [DECIDED]:** BUILD LATER \
**Phase:** Future backlog | **Report location:** p. 2

**Scope:** React/headless UI runtime over existing REST API.

**Acceptance criteria / future design gate:** Future: independently rendered forms with parity, versioning and auth.

**Dependencies and non-goals:** Depends on schema/renderer stability.

### F-07 — PDF / document generation

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P3 | **Report location:** p. 2

**Scope:** Basic per-response PDF download plus automatic generation. Four types: response summary; order confirmation/basic invoice; registration/application confirmation; certificate. Per-form recipients: owner/respondent/both/neither, plus authorized additional recipients if supported. Ready-made templates editable for logo/colors/heading/footer/text/numbering. Smart triggers: successful submit; accurate order/payment state; registration confirmation; qualification/completion criteria. No drag-and-drop document designer.

**Acceptance criteria / future design gate:** PDF export available to authorized users; correct templates render long responses and signatures; recipient settings respected; document numbering unique within defined scope; documents retrievable without exposing other respondents; triggering is idempotent; unpaid order never labeled paid; qualifying certificate only issued on qualifying event; PDF/email failure appears in response timeline.

**Dependencies and non-goals:** Depends on 3,4,10,25,31; payment events from 22/35 later. Tax-compliant invoicing outside scope absent explicit requirements.

### F-08 — Email / SMS OTP verification

**Decision [DECIDED]:** BUILD LATER \
**Phase:** Future backlog | **Report location:** p. 2

**Scope:** Optional respondent verification of contact channels.

**Acceptance criteria / future design gate:** Future: email and SMS delivery, expiry, attempt/resend limits, verified flags and abuse resistance.

**Dependencies and non-goals:** SMS provider (41) also deferred.

### F-09 — Reusable governed question blocks

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P1 | **Report location:** p. 2

**Scope:** Shared library of versioned question/groups; centralized edits, permissions and controlled updates to consuming forms.

**Acceptance criteria / future design gate:** Creator can save and insert shared block; usage references track exact block version; modifying shared block creates a new version, does not silently alter published forms; owners can review/apply updates; rollback and block permissions work; conditional references remain valid after update.

**Dependencies and non-goals:** Depends on canonical form schema, version history and permissions.

### F-10 — Basic e-signature field

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P2 | **Report location:** p. 2

**Scope:** Signature capture via mouse/touch/stylus, required/optional, secure storage and timestamp; embed in PDF. Excludes multi-signer contractual signing/audit platform.

**Acceptance criteria / future design gate:** Respondent can sign/clear/redo on desktop and mobile; required signature validated; signature bound to correct response and timestamp; authorized PDF renders it; storage/access rules protect signature; no representation as certified legal signature.

**Dependencies and non-goals:** Depends on file storage and 7 PDF integration.

### F-11 — Matrix / grid question

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P1 | **Report location:** p. 3

**Scope:** Single-select and multi-select grids; custom rows/columns; required-row validation; responsive display; logic and reporting.

**Acceptance criteria / future design gate:** Grid response stores answer per row; invalid required rows blocked; mobile supports horizontal overflow or accessible stacked view; exports/analytics accurately represent each row; conditional rules can inspect matrix answers.

**Dependencies and non-goals:** Schema, builder, renderer, analytics/export.

### F-12 — Picture choice

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P1 | **Report location:** p. 3

**Scope:** Image on each answer option; single/multiple choice, responsive cards, labels and alt text, logic compatibility.

**Acceptance criteria / future design gate:** Creator uploads/replaces/removes option images; respondent selects via click/tap/keyboard; missing image has accessible fallback; exports retain stable option IDs/text (not raw URLs only); conditional logic works.

**Dependencies and non-goals:** Media handling and answer-choice renderer.

### F-13 — Address field

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P1 | **Report location:** p. 3

**Scope:** Structured address fields: lines 1/2, city, state/province, postal code, country, with configurable required parts.

**Acceptance criteria / future design gate:** Builder configures constituent fields; respondent can fill in mobile and desktop; validation works without assuming every country uses a state or fixed-length postcode; saved/exported data remains structured.

**Dependencies and non-goals:** Use existing contact/field mechanisms; autocomplete/maps not implicitly included.

### F-14 — Custom CSS

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P1 | **Report location:** p. 3

**Scope:** Per-form custom CSS editor with preview, error reporting, reset and CSP compatibility.

**Acceptance criteria / future design gate:** Styles only form rendering scope; edits never affect dashboard or other customers; unsafe content cannot break CSP; published versus draft CSS versions are controlled; failure recovery/reset available; mobile styling supported.

**Dependencies and non-goals:** Security review for CSS isolation and nonce-based CSP.

### F-15 — Kiosk mode

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P1 | **Report location:** p. 3

**Scope:** Kiosk fullscreen flow, auto-reset after submission, configurable reset timer, PIN-like exit deterrent, idle timeout and session isolation.

**Acceptance criteria / future design gate:** Next respondent sees no prior answers or private data; idle timeout resets form; kiosk mode works on target tablet browsers; exit PIN does not falsely claim OS-level lockdown; partial answers are handled according to defined kiosk policy.

**Dependencies and non-goals:** Shared renderer with Feature 1; browser full-screen API limits.

### F-16 — Open JSON form-schema export

**Decision [DECIDED]:** BUILD LATER \
**Phase:** Future backlog | **Report location:** p. 3

**Scope:** Public export of documented versioned form definition, excluding credentials and respondent data.

**Acceptance criteria / future design gate:** Future: versioned portable export, schema validation and safe metadata redaction.

**Dependencies and non-goals:** Useful to import (5), but not required now.

### F-17 — Offline collection

**Decision [DECIDED]:** BUILD LATER \
**Phase:** Future backlog | **Report location:** p. 3

**Scope:** Offline form load, secure local queue and synchronization.

**Acceptance criteria / future design gate:** Future: tested conflict handling, encryption, deduplication and limitations on server-dependent components.

**Dependencies and non-goals:** High effort.

### F-18 — Ranking question

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P1 | **Report location:** p. 3

**Scope:** Drag/touch/keyboard reordering, optional top-N ranking, required rules, analytics and exports.

**Acceptance criteria / future design gate:** User can rank by mouse, touch and keyboard; duplicates/gaps invalid where full ranking required; partial ranking respects configured N; ranking order round-trips through save/resume and export; scoring/logic read ranking correctly.

**Dependencies and non-goals:** Builder/renderer/analytics.

### F-19 — Native Android / iOS app

**Decision [DECIDED]:** BUILD LATER \
**Phase:** Future backlog | **Report location:** p. 3

**Scope:** Dedicated mobile app for form and lead management.

**Acceptance criteria / future design gate:** Future: define initial app scope, offline and push notification needs before platform commitment.

**Dependencies and non-goals:** Mobile web quality remains NOW baseline across all features.

### F-20 — Time and date-time fields

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P1 | **Report location:** p. 3

**Scope:** Time and combined date-time; 12/24-hour display; min/max limits; intervals; timezone-aware storage and export.

**Acceptance criteria / future design gate:** Picker works on mobile; locale display and stored canonical value remain consistent; min/max and interval constraints enforced server-side; DST and unspecified timezone behavior documented/tested; logic/export preserves meaning.

**Dependencies and non-goals:** Builder/renderer/validation; booking (27) uses separate availability semantics.

### F-21 — Video / audio answers

**Decision [DECIDED]:** BUILD LATER \
**Phase:** Future backlog | **Report location:** p. 3

**Scope:** Record audio/video in browser and attach media to response.

**Acceptance criteria / future design gate:** Future: consent, storage/bandwidth limits, playback and retention.

**Dependencies and non-goals:** Media costs and privacy require design.

### F-22 — Payments enhancement

**Decision [DECIDED]:** BUILD NOW — AT THE END \
**Phase:** P7 | **Report location:** p. 4

**Scope:** Add in-form payment experience, Razorpay/UPI, coupons, order/payment status and PDF receipts, integrated with Product Block. PayPal and subscriptions explicitly deferred.

**Acceptance criteria / future design gate:** Order amount computed server-side; payment starts from a uniquely identified order; provider callbacks signature-verified; race/retry/idempotency tests prevent double charging; failed/abandoned payment does not become paid; coupons validate server-side; receipt/PDF reflects actual status; card data stays with provider.

**Dependencies and non-goals:** Same work package as Feature 35; depends on 4,7,31 and booking/caps if paid reservations.

### F-23 — AI form editing

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P4 | **Report location:** p. 4

**Scope:** Edit existing fields, logic and theme using natural language; preview diff, explicit approval, undo and validation.

**Acceptance criteria / future design gate:** AI produces reviewable change set rather than silently modifying live form; all edits checked by same schema/logic rules as manual edits; rejected changes leave form untouched; applied changes versioned and reversible; multi-step instructions handled; errors surface safely.

**Dependencies and non-goals:** Requires stable form schema/versioning and safeguards against destructive or published edits.

### F-24 — Advanced embed modes

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P3 | **Report location:** p. 4

**Scope:** Inline/popup plus slide-in, side-tab, full-page; JavaScript embed SDK; click/delay/scroll triggers and analytics.

**Acceptance criteria / future design gate:** Sample integration works on third-party test pages; script loads only configured form; opening/closing and focus management accessible; mobile view works; trigger and impression/start/submit analytics avoid duplicates; embed cannot escape site/browser security boundaries.

**Dependencies and non-goals:** Not the headless React renderer (6). Feature 14 styling and 29 experiments interact.

### F-25 — Advanced email notifications

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P3 | **Report location:** p. 4

**Scope:** Multiple recipients, answer-based routing, daily digest, custom subjects, merge variables and delivery tracking.

**Acceptance criteria / future design gate:** Conditional routing sends to correct approved recipients; malformed addresses do not leak data; merge variables escaped; digest uses defined timezone and avoids duplicate summaries; send success/failure recorded; unsubscribe/consent semantics applied as relevant.

**Dependencies and non-goals:** Current email provider; response timeline 31; PDFs 7.

### F-26 — CAPTCHA / bot protection

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P0 | **Report location:** p. 4

**Scope:** Cloudflare Turnstile per-form toggle with server-side token verification, attempt logging and graceful failure; retain honeypot/rate limits/bot filters.

**Acceptance criteria / future design gate:** Submissions requiring CAPTCHA rejected on missing/invalid/expired token, with server-side verification; site key/secret separated; mobile and accessibility test pass; failed provider calls fail safely; bot protections remain active.

**Dependencies and non-goals:** Security/privacy review; provider credential management.

### F-27 — Fully native booking system

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P5 | **Report location:** p. 4

**Scope:** Native scheduling engine (NOT Calendly embed): availability, slots, timezone, booking state, change/cancel, buffer, reminders, team scheduling and double-booking prevention. Google Calendar sync in Feature 43; Outlook sync was requested as part of this feature but Feature 39 Microsoft 365 broad integration is deferred, so Outlook calendar dependency must be explicitly scoped and reconciled.

**Acceptance criteria / future design gate:** Respondent books an actually available slot; atomic booking prevents overbooking; cancellations/reschedules free/update slots; timezone/DST tested; confirmation/reminder timing reliable; teams and buffers respected; booking lifecycle visible; calendar-provider failures never create ambiguous booking state.

**Dependencies and non-goals:** Feature 43 Google Calendar NOW; Feature 39 Microsoft 365 suite LATER. See decision log for overlap and unresolved Outlook scope.

### F-28 — Visible-answer URL prefill

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P1 | **Report location:** p. 4

**Scope:** Map URL parameters into visible editable fields; validate and apply conditional logic; warn on PII in URLs.

**Acceptance criteria / future design gate:** Known parameters prefill supported fields and stay editable; unknown/invalid values do not bypass validation; no hidden privileged fields set via URL; logic recalculates after prefill; no secrets emitted into links/logs by the product.

**Dependencies and non-goals:** Built on hidden URL fields and profiling.

### F-29 — Advanced in-form A/B testing

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P4 | **Report location:** p. 4

**Scope:** Variants of wording, question order and layout within one form; traffic allocation, conversion and statistical reporting, recommendations and winner adoption.

**Acceptance criteria / future design gate:** Respondent remains in assigned variant across resume; analytics use correctly attributed denominators; UI surfaces insufficient sample caveats; variants can be paused and winner adopted without invalidating previously collected responses; recommendations do not auto-publish.

**Dependencies and non-goals:** Existing cross-form A/B testing; integrates renderer and analytics.

### F-30 — Advanced survey analytics

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P4 | **Report location:** p. 4

**Scope:** Cross-tabs, response/date/source filters, scheduled emails, NPS templates/calculation/trends and 360 feedback templates/aggregation, export.

**Acceptance criteria / future design gate:** Cross-tabs reconcile to source response totals with filters; NPS promoter/passive/detractor bins and formula correct; scheduled sends idempotent; 360 reports apply permission and privacy rules, including confidentiality threshold if configured; exports match dashboards.

**Dependencies and non-goals:** Response schema and security; reports use live authorized data.

### F-31 — Per-response observability timeline

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P2 | **Report location:** p. 5

**Scope:** Timeline of started/saved/submitted/paid/email/webhook/CRM/sheet actions; statuses, errors, authorized manual replay.

**Acceptance criteria / future design gate:** Every integration attempt has linked response ID, timestamp and outcome; events ordered consistently; permissions redact sensitive payloads; replay restricted to safe actions with idempotency keys; payment replay never triggers duplicate charge; failures traceable to specific attempt.

**Dependencies and non-goals:** Build logging contract before scaling integrations.

### F-32 — Compliance and privacy expansion

**Decision [DECIDED]:** BUILD LATER \
**Phase:** Future backlog | **Report location:** p. 5

**Scope:** Field-level answer encryption, data residency, HIPAA-oriented configuration and certification readiness. User changed initial NOW to LATER.

**Acceptance criteria / future design gate:** Future requires architecture, vendor, legal, operations and independent certification plan; no claims of HIPAA/SOC2/ISO compliance before verified.

**Dependencies and non-goals:** Baseline access control, data retention and privacy obligations remain mandatory now.

### F-33 — Airtable integration

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P6 | **Report location:** p. 5

**Scope:** OAuth, base/table selection, mapping, conditional one-way record creation, retries, status and connection management.

**Acceptance criteria / future design gate:** Supported Airtable fields map correctly; integration can be revoked; duplicates avoided on retry; failures recorded per response; creator sees mapping/permission issues.

**Dependencies and non-goals:** Shared integration framework, 31.

### F-34 — Salesforce integration

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P6 | **Report location:** p. 5

**Scope:** OAuth, lead/contact creation, standard/custom mapping, configurable deduplication and routing, retry/logging.

**Acceptance criteria / future design gate:** Admin can map required Salesforce fields and view unsupported field types; no duplicate leads on webhook retries; auth refresh/revoke handled; per-response status/troubleshooting available.

**Dependencies and non-goals:** Shared integration framework and object model; 31.

### F-35 — Razorpay / UPI integration

**Decision [DECIDED]:** BUILD NOW — AT THE END \
**Phase:** P7 | **Report location:** p. 5

**Scope:** Same engineering delivery as Feature 22 payments enhancement: Razorpay and UPI; verified webhooks; dynamic orders; coupons; idempotency and receipts.

**Acceptance criteria / future design gate:** One integration acceptance suite shared with Feature 22; only one canonical implementation task/estimate; UPI/card methods subject to merchant activation; payment status verified on server.

**Dependencies and non-goals:** Deduplicate with 22.

### F-36 — Notion integration

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P6 | **Report location:** p. 5

**Scope:** OAuth workspace connection, target data source/database selection, properties mapping, page creation, conditional sync and retry.

**Acceptance criteria / future design gate:** Submissions create valid Notion pages in selected destination; field mismatch visible; retries do not produce duplicates; revocation stops further sync; errors appear on timeline.

**Dependencies and non-goals:** Shared integration framework; 31.

### F-37 — PayPal integration

**Decision [DECIDED]:** BUILD LATER \
**Phase:** Future backlog | **Report location:** p. 5

**Scope:** PayPal payments using shared payment abstraction.

**Acceptance criteria / future design gate:** Future: PayPal authorization, webhook verification, reconciliation and refunds; not part of 22 NOW-at-end scope.

**Dependencies and non-goals:** 22/35 payment architecture.

### F-38 — Mailchimp integration

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P6 | **Report location:** p. 5

**Scope:** Connect account, audience, fields, tags, conditional sync and consent-based opt-in, duplicate updating, retries and timeline.

**Acceptance criteria / future design gate:** Only opted-in respondents subscribed where required; provider subscription/double-opt-in behavior honored; mapping, tags and update match; no duplicates; revoked connections stop sync.

**Dependencies and non-goals:** Marketing consent and shared integration framework.

### F-39 — Microsoft 365 integration suite

**Decision [DECIDED]:** BUILD LATER \
**Phase:** Future backlog | **Report location:** p. 5

**Scope:** Excel, Teams and Outlook suite integration.

**Acceptance criteria / future design gate:** Future: connected account, Excel write, Teams notify, Outlook features after scoping.

**Dependencies and non-goals:** Does not automatically cancel specifically approved native-booking calendar integrations under 27/43.

### F-40 — Zoho CRM and Pipedrive integrations

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P6 | **Report location:** p. 6

**Scope:** Connect Zoho CRM and Pipedrive, map fields, create/update leads or contacts, conditional sync, dedupe and retries.

**Acceptance criteria / future design gate:** Both connectors independently pass auth, required-field mapping, duplicate retry and disconnect tests; errors observable by response.

**Dependencies and non-goals:** Shared integration framework; 31.

### F-41 — SMS provider (MSG91 / Twilio)

**Decision [DECIDED]:** BUILD LATER \
**Phase:** Future backlog | **Report location:** p. 6

**Scope:** SMS provider integrations for notifications and eventual OTP.

**Acceptance criteria / future design gate:** Future: provider controls, cost/consent, delivery status and rate limits.

**Dependencies and non-goals:** 8 OTP also later; 27 reminder transport default email initially.

### F-42 — WhatsApp integration

**Decision [DECIDED]:** BUILD LATER \
**Phase:** Future backlog | **Report location:** p. 6

**Scope:** WhatsApp Business outbound templated messaging and notifications.

**Acceptance criteria / future design gate:** Future: opted-in template sending, status, retry and billing.

**Dependencies and non-goals:** Do not promise WhatsApp reminders in native booking now.

### F-43 — Google Calendar native booking integration

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P5 | **Report location:** p. 6

**Scope:** Google OAuth/calendar selection, busy-slot lookup, create/update/cancel events and invitations, two-way sync and error history.

**Acceptance criteria / future design gate:** Provider busy events block slot offers; sync webhook/poll changes update booking safely; canceled/rescheduled slots reconcile; OAuth permissions, errors and timezone tested; one calendar sync module within Feature 27, not duplicate scheduling engine.

**Dependencies and non-goals:** Sub-workstream under 27; 39 generic M365 later.

### F-44 — LinkedIn Insight Tag / TikTok Pixel

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P3 | **Report location:** p. 6

**Scope:** Per-form pixel IDs, view/start/submit conversions, optional custom events, consent gating, testing and deduplication.

**Acceptance criteria / future design gate:** Events fire once at correct lifecycle moments; no conversion sent on failed submission; consent and regional settings honored; works with existing GA4/GTM/Meta without duplicate tracking; configuration verifiable.

**Dependencies and non-goals:** Existing pixel infrastructure and data privacy settings.

### F-45 — Zendesk and Intercom

**Decision [DECIDED]:** BUILD LATER \
**Phase:** Future backlog | **Report location:** p. 6

**Scope:** Support ticket and conversation integrations.

**Acceptance criteria / future design gate:** Future: auth, contact/ticket mapping, retry and lifecycle events.

**Dependencies and non-goals:** Shared integration framework.

### F-46 — Scheduled form close date

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P0 | **Report location:** p. 3

**Scope:** Configure closing deadline/timezone, closed message, dashboard status, optional countdown/reopen/notifications; server-side enforcement.

**Acceptance criteria / future design gate:** Submission arriving after cutoff rejected even if form loaded earlier; timezones/DST tested; owner can adjust schedule; custom closed-state shown consistently on direct/embedded links; override auditable.

**Dependencies and non-goals:** Forms availability policy, shared with response cap (47).

### F-47 — Response cap per form

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P0 | **Report location:** p. 3

**Scope:** Maximum accepted responses, remaining counter, automatic closure, custom full message, concurrency-safe enforcement, optional capacity adjustment and notification; exclude partials by default.

**Acceptance criteria / future design gate:** Simultaneous submissions cannot exceed cap; only defined accepted/completed states consume cap; abandoned/failed attempts do not block future users; paid reservation policy prevents oversell and releases failures; creator can raise cap; embedded links honor closure.

**Dependencies and non-goals:** Forms availability policy; payment reservation policy links to 22.

### F-48 — Password-protected forms

**Decision [DECIDED]:** BUILD NOW \
**Phase:** P0 | **Report location:** p. 3

**Scope:** Per-form shared password toggle, salted secure hash, protected entry and session, attempt throttling, change/reset and access audit.

**Acceptance criteria / future design gate:** Before successful unlock, neither form questions nor protected submit endpoints accessible; password never stored/displayed in plaintext or logs; rate limit tested; changing password invalidates prior access as designed; access session expires; not represented as verified identity.

**Dependencies and non-goals:** Auth/session and form access middleware.

## 5. Cross-cutting engineering contracts

### 5.1 Data and schema changes

- Maintain a **versioned canonical form definition** shared by builder, live renderer, preview, embeds, import, AI editing and experiments. Field IDs must remain stable across edits, exports and response reporting.
- Distinguish **form definition**, **submission**, **partial response**, **response status**, **audit event**, **outbound delivery**, **order/payment**, **booking** and **generated document** as separate domain entities. Do not overload a single response-status field for payment, booking and delivery states.
- Use backward-compatible migrations for forms already published; expose schema migration/rollback requirements in every pull request.
- Define durable integration action identifiers and idempotency keys. Retries and manual replay must be safe even after network timeouts.

### 5.2 Access, privacy and security

- Enforce permissions server-side across records, comments, signatures, generated PDFs, integrations, logs, bookings and protected forms; client-side hiding is insufficient.
- Keep third-party tokens and credentials in managed secrets; mask them in logs; support revoke/reconnect flows. Use least-privilege provider scopes.
- Explicitly separate **submission acceptance**, **payment confirmation**, **certificate eligibility**, **booking confirmation** and **external delivery**. These are different state transitions.
- Validate all imported/URL-prefilled data as untrusted input; sanitize templates, HTML, messages and custom styles within existing CSP boundaries.
- Respect retention, deletion and export privileges across newly added records, documents, logs, signatures and provider payloads. The deferred compliance epic does not exempt this baseline.

### 5.3 Shared integrations framework

- All NOW connectors (#33, #34, #36, #38, #40 and calendar #43) should use a shared connection framework: authorize/revoke, source-response association, mapping, conditional dispatch, retry with backoff, poison/error state, per-attempt log and manual replay controls.
- Define provider quotas, conflict policies, record deduplication keys and credential refresh behavior per connector. If provider supports only particular field/object types, surface the restriction in configuration and failure details.
- Never perform a destructive or billable action twice solely because a webhook timed out or a worker retried.

### 5.4 Product experience

- Every new builder capability needs authoring UI, preview, published runtime, accessible/mobile behavior, validation, persistence, team permissions and customer-facing help text.
- Support both classic and conversational display where technically applicable; where a feature cannot work in a specific renderer or offline context, fail explicitly with a design-time warning.
- Keep conversion events consistent across direct links, embeds, variants and kiosk sessions.

## 6. Acceptance testing & release gates

| Gate                 | Required evidence before release                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| Functional           | End-to-end demos of every NOW acceptance criterion and negative-path tests                       |
| Regression           | Existing live forms, logic, formulas, save/resume, analytics and exports behave as before        |
| Mobile/accessibility | Screen-reader/keyboard/touch checks for every added question type and embed mode                 |
| Authorization        | Role-permission tests including cross-tenant response, signature, PDF and integration access     |
| Resilience           | Retries, timeouts, canceled requests, replay, idempotency, parallel submission tests             |
| External connections | Sandbox and real-provider smoke test where available; document unavailable credentials/providers |
| Data integrity       | Backward migration, rollback, stable IDs and export/report parity                                |
| Product support      | Settings documentation, error states, audit logs and support troubleshooting instructions        |

### 6.1 High-risk test scenarios

1. Two respondents submit simultaneously for the final response-cap slot; only one succeeds.
2. One final booking slot is selected concurrently; booking becomes confirmed once only, and calendars converge.
3. Payment provider sends duplicate/out-of-order success/failure webhooks; exactly one correct terminal order state and no duplicate charge.
4. AI removes a field referenced by conditional logic; preview warns, publish blocked until corrected, rollback available.
5. Public imported form has hidden branching or inaccessible required settings; importer flags unknowns, stays draft and never invents logic.
6. Saved partial response crosses a scheduled-close time; server correctly rejects late final submit unless creator changes close policy.
7. A response is deleted under retention/privacy rules; PDF, signatures and relevant stored copies honor the specified deletion model.
8. An unauthorized user requests another tenant's PDF, record, booking or integration log; request denied at API/data layer.
9. Kiosk times out after PII entry; new respondent sees no prior data.
10. CAPTCHA secret missing or provider unavailable; protected submissions do not silently bypass server-side verification.

## 7. Work breakdown, dependencies and estimation

| Workstream                                | Feature IDs                       | Lead discipline             | Blocking dependencies                    |
| ----------------------------------------- | --------------------------------- | --------------------------- | ---------------------------------------- |
| Core security/availability                | 26, 46, 47, 48                    | Platform/full-stack         | Existing auth, public form API           |
| Renderer + field types                    | 1, 11, 12, 13, 14, 15, 18, 20, 28 | Frontend + schema/backend   | Canonical schema, logic/validation       |
| Records, governance, import               | 3, 5, 9, 10, 31                   | Full-stack + integrations   | Versioning, permissions, event contracts |
| Order, document, notifications            | 4, 7, 25                          | Full-stack + template/email | Order data, records, e-signature         |
| Distribution and measurement              | 24, 44, 29, 30                    | Frontend + analytics        | Reliable event definitions               |
| AI edit agent                             | 23                                | AI/full-stack               | Schema diff, published-state review/undo |
| Native booking with calendar              | 27, 43                            | Full-stack/integrations     | Atomic reservation and calendar events   |
| CRM/database/email marketing integrations | 33, 34, 36, 38, 40                | Integrations                | Shared auth, mapping, timeline/replay    |
| **Final** payments/Razorpay               | **22, 35 (one epic)**             | Payments/full-stack         | Product orders, docs, webhook events     |

**Mandatory estimation request to engineering:** For each unique workstream, supply owner, backend days, frontend days, QA days, infra/vendor work, test-account prerequisites, migrations, security risk, and a confidence range. Split into deliverable tickets before assigning dates. The report's Low/Medium/High are directional only and are not sprint estimates.

## 8. Deferred roadmap — explicit exclusion from current delivery

| Feature                               | Deferred scope                                                                                                                              | Important connection                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| F-02 Workflow and approval engine     | Multi-stage approval, approver assignment and task workflow.                                                                                | Depends on Records View and identity/permissions.                                                     |
| F-06 Headless SDK / React renderer    | React/headless UI runtime over existing REST API.                                                                                           | Depends on schema/renderer stability.                                                                 |
| F-08 Email / SMS OTP verification     | Optional respondent verification of contact channels.                                                                                       | SMS provider (41) also deferred.                                                                      |
| F-16 Open JSON form-schema export     | Public export of documented versioned form definition, excluding credentials and respondent data.                                           | Useful to import (5), but not required now.                                                           |
| F-17 Offline collection               | Offline form load, secure local queue and synchronization.                                                                                  | High effort.                                                                                          |
| F-19 Native Android / iOS app         | Dedicated mobile app for form and lead management.                                                                                          | Mobile web quality remains NOW baseline across all features.                                          |
| F-21 Video / audio answers            | Record audio/video in browser and attach media to response.                                                                                 | Media costs and privacy require design.                                                               |
| F-32 Compliance and privacy expansion | Field-level answer encryption, data residency, HIPAA-oriented configuration and certification readiness. User changed initial NOW to LATER. | Baseline access control, data retention and privacy obligations remain mandatory now.                 |
| F-37 PayPal integration               | PayPal payments using shared payment abstraction.                                                                                           | 22/35 payment architecture.                                                                           |
| F-39 Microsoft 365 integration suite  | Excel, Teams and Outlook suite integration.                                                                                                 | Does not automatically cancel specifically approved native-booking calendar integrations under 27/43. |
| F-41 SMS provider (MSG91 / Twilio)    | SMS provider integrations for notifications and eventual OTP.                                                                               | 8 OTP also later; 27 reminder transport default email initially.                                      |
| F-42 WhatsApp integration             | WhatsApp Business outbound templated messaging and notifications.                                                                           | Do not promise WhatsApp reminders in native booking now.                                              |
| F-45 Zendesk and Intercom             | Support ticket and conversation integrations.                                                                                               | Shared integration framework.                                                                         |

**Additional deferred scope inside a current epic:** PayPal and recurring subscriptions are deferred even though payment enhancements/Razorpay are Build Now — At the End. Advanced multi-signer legal signing, drag-and-drop document design, historical response import and full headless React runtime are outside the approved NOW scope.

## 9. Decisions requiring product-owner signoff before coding (do not assume)

These items were **not explicitly settled by the 48 priority responses** and should be converted to short product decisions or ADRs before engineering estimates are locked:

1. **Outlook Calendar:** Include lightweight booking-only Outlook sync under #27, despite broad Microsoft 365 suite #39 being deferred, or defer Outlook entirely? Google Calendar #43 is confirmed NOW.
2. **Booking specifics:** Required first-release appointment types, appointment duration rules, team assignment, provider ownership, reminders cadence, cancellation/reschedule windows, event links and handling of provider outages.
3. **Order and money:** Supported currencies, coupon stack rules, taxes/invoice jurisdiction, payment confirmation and refunds, inventory/capacity reservation when payments are pending. Tax-compliant invoices are not implied.
4. **Records governance:** Response status vocabulary, who may assign/comment, whether Kanban is MVP or enhancement, event retention and whether edits to submitted answers are allowed.
5. **Reusable blocks:** When and how consuming forms receive new versions; whether changes require every form owner approval (recommended baseline) and what happens when local overrides exist.
6. **PDF scope:** Template catalog/design handoff, document numbering uniqueness scope, storage retention, additional recipient permissions, certificate eligibility rule definitions and document generation retry policy.
7. **Public-link import:** Expected source form samples, maximum form size, required parity for layout/theme, handling source platform anti-bot restrictions and how incomplete conditional logic is presented.
8. **A/B experiments:** Statistical decision rules, sample size safeguards, traffic changes mid-test and exact winner recommendation behavior.
9. **360 feedback:** Confidentiality thresholds, respondent anonymity and who may view individual ratings.
10. **Monetization/plan gating:** The report warns competitors offer many premium-gated features free. No new plan entitlements, prices or rate limits were decided; request pricing decision separately.

## 10. Delivery checklist for every ticket

- [ ] Feature linked to its F-## decision and phase; overlapping epic identified.
- [ ] Product interaction and negative/error states specified; no implicit assumptions.
- [ ] Schema changes, migrations and rollback plan reviewed.
- [ ] Permissions, privacy, retention and abuse checks passed.
- [ ] Acceptance criteria implemented with automated test coverage where practical.
- [ ] Responsive/accessible experience tested.
- [ ] Analytics events and response lifecycle logging emitted correctly.
- [ ] Retries/idempotency implemented for background work.
- [ ] Documentation, configuration defaults and migration notes shipped.
- [ ] Live-provider testing notes recorded (or documented blocker).
- [ ] Feature flagged/rolled out safely; no unreviewed publication of imported/AI-generated changes.

## 11. Source boundary and status

The gap classifications and existing-feature descriptions above come from the October 28, 2026 report. The priority decisions and the explicit exceptions (import workflow, PDF behavior, basic signature, native booking, Turnstile, final-phase payments, deferred #32) come from the user's questionnaire. The phase order, acceptance tests, engineering contracts and unresolved-decision list are **implementation recommendations**, not claims verified in the repo. The original report states it inspected code but did not run the application, so an engineering kickoff should confirm production behavior before assigning build tasks.

**End of specification — 48/48 decisions transcribed; 33 NOW + 2 END + 13 LATER = 48.**
