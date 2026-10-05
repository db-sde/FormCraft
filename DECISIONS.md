# Decisions

Record of choices made where the Phase 1 spec was ambiguous or left an
implementation detail open. Newest first.

## 2026-10-03 — UX pass: the build loop is typing, not clicking

A walkthrough of every creator journey as a new user, counting clicks.
Most of the app was already one click per intent; the waste was in the
builder's most repeated loop and in three hand-offs. From the dashboard
to a named, published form with a choice question is now **two clicks**
("New form", "Publish"); before it was about fourteen plus manual
select-and-replace on every starter text.

- **Adding a question puts the cursor in it.** The new question's (or
  duplicated question's, or ending's) text is focused with its starter
  wording selected, so typing replaces it. Before, focus stayed on "Add
  question" — typing did nothing, and a space re-opened the menu and
  added stray questions.
- **Enter moves on** from a question's text: to the first option of a
  choice question, otherwise to "Add question" (Shift+Enter is still a
  new line). "Add question" opens on a search field, so a type is a few
  letters and Enter; matches on a type's name rank above matches in its
  description ("check" is Checkboxes, not Email's "Checked
  automatically").
- **Options are a typed list.** Enter goes to the next option — an
  unedited starter one first, then a new one; a final Enter on an
  untouched option ends the list and removes it; Backspace on an empty
  option removes it; arrows move between them. Starter wording
  ("Option 2") is selected on focus. Pasting several lines still splits.
- **A form is named once.** Its name follows the welcome screen's title
  for as long as the two are the same; renaming it in the top bar to
  something else unlinks them. An unnamed form opens with that title
  selected.
- **Publishing hands over the link.** The first publish copies the live
  link and says so; later publishes offer "Copy link" instead of writing
  to the clipboard unasked again. If the clipboard isn't available the
  toast offers the button.
- **A heads-up, not a gate, for starter wording.** Publishing with
  "Pick one" or "Option 2" still in the form shows a warning that jumps
  to the first such question. It doesn't block: the creator may mean it.
- **The welcome dialog's cards act on click** (was select, then
  confirm), and its copy now describes the starter form accurately.
- **The dashboard's response count is a link** to that form's responses
  (was: open the form, then the Responses tab).
- **Kept as is:** the starter form's three questions (a working contact
  form with lead capture, which the publish-and-respond tests cover).
  Someone wanting something else deletes them; a truly blank start would
  be a product change, not a click fix.

## 2026-10-03 — External data: lookups fill URL fields, on the server

- **Shape.** A data lookup runs when the respondent leaves a chosen
  question: the server GETs the creator's API and copies fields from the
  JSON reply into the form's **URL fields**. Rules, formulas and recall
  already read those, and they're already stored per response, so the
  engine needed no new concept and the server's walk at submission reads
  the looked-up value from the database — never from the browser.
- **A respondent triggers an outbound request, so it's boxed in.** The
  host comes only from the saved URL (validated like a webhook: HTTPS,
  public address, checked again at call time); answers are inserted
  percent-encoded into the path or query and can't change the host,
  add path segments or parameters. GET only, no redirects, 4 seconds,
  64 KB, JSON only. At most 10 calls per response and 20 an hour per
  address. Only declared URL fields are written, as strings of at most
  500 characters; objects and lists in the reply are ignored.
- **The secret header** is encrypted like other credentials and never
  leaves the server. The lookup itself lives in `form_lookups`, not in
  the form's schema, because the schema is sent to browsers. That makes
  lookups form-level settings that apply to the live form at once (like
  payment settings) rather than part of an immutable version.
- **A looked-up field can't be spoofed from the URL**: values for fields
  a lookup fills are dropped at start, in the browser and on the server.
  If the lookup fails the field is simply empty (or its default).
- **Looked-up values are visible to the respondent's browser** — the
  form's logic runs there too. The panel says so: only fetch what a
  respondent may see.
- **Failure never blocks the form.** A slow or failing API means no
  values; the respondent waits at most a few seconds, once per answer.
- **Limits accepted.** Like webhooks, the address check and the request
  are separate DNS lookups (a rebinding window); no retries; no POST; no
  "test this lookup" button yet. Needs answers saved as they're given
  (a form that keeps nothing until submit has no response to attach
  values to). Business plan and up (`data_lookups`).

## 2026-10-03 — Progressive profiling: remembered by browser, filled in, never shown

- **Who is "the same person"?** The random first-party visitor id the
  proxy already sets on form pages (`fc_vid`, httpOnly). No sign-in and
  no matching by email — an email typed into a form isn't proof of who
  is typing. So it's really "the same browser", and the copy says so.
- **Scope is one workspace.** A creator's forms share what a visitor
  told them; nothing crosses to another customer's workspace.
- **A remembered answer is filled in, not treated specially.** The
  runtime puts it into the answers and steps past the question, so the
  response is complete on its own and the server's walk, validation,
  exports and integrations need no special case. It's reused only by a
  question of the same type and only while it's still a valid answer
  there; choice questions are excluded because option ids belong to one
  form.
- **Never shown, never auto-submitted.** Going back steps over filled-in
  questions, so someone else at the same browser can't read them. A
  remembered question that is the last step is asked again rather than
  submitted automatically. "Answer again" clears them for this response.
- **Minimal by default.** The visitor id is stored on a response only if
  the form has "ask once" questions; the id comes from the cookie on the
  server, never from the request body; remembered answers expire after
  395 days without use; a privacy request that erases someone's
  responses also forgets their browser.

## 2026-10-03 — Logic engine: adaptive assessments and benchmarks

- **Adaptive assessments (spec phase 20) extend question pools** rather
  than adding a new concept: a pool can be marked adaptive, with a
  difficulty (1–5) per question and a starting level. It asks `pick`
  questions one at a time; a right answer raises the target level by
  one, a wrong one lowers it, and the next question is the unasked one
  nearest the target (ties: the easier one, then a seeded shuffle so
  respondents at the same level don't all get the same question).
- **"Right" means exactly the options marked correct** (single choice,
  dropdown, multi-select). A question with nothing marked doesn't move
  the level; the Check tab warns about it, about optional questions
  (skipping one ends the group) and about groups with a single level.
- **Still deterministic and server-authoritative.** The sequence is a
  pure function of the answers and the response's seed, so the browser's
  step-by-step path and the server's walk are the same (tested for every
  answer pattern across seeds). Extra answers sent for questions that
  weren't asked are ignored; an answer changed after the fact re-plans
  the sequence, and a question that then lacks an answer fails the
  required check instead of being scored.
- **The next question can sit earlier in the form's order** than the
  current one. That's the one place the engine looks backwards; it only
  offers that group's due question, and termination still holds because
  no question is shown twice.
- **Not item-response theory.** No per-question statistics or ability
  estimate, just levels and a staircase — simple enough for a creator to
  predict, and enough for placement-style quizzes. Scoring is unchanged:
  option points and rules, on the questions actually asked.
- **Benchmarks (phase 36):** `npm run bench:logic` and a budget test.
  At the schema's limits (200 questions, 500 rules) a server walk takes
  under half a millisecond and 2,000 replays about 0.7 s, so no caching
  or incremental evaluation is warranted; the replay design stays.

## 2026-10-03 — Phase 3, Wave C: SSO, SCIM, compliance

- **SSO (P3.12) rides on Supabase Auth's SAML support** rather than a
  SAML implementation of our own. An operator registers the identity
  provider (`supabase sso add`, Pro plan) and maps it to a workspace
  with `npm run sso:set` (service role). Workspace admins can only
  choose the default role and whether SSO is required — if they could
  set the provider themselves, one workspace could point another
  company's provider at itself and collect its people.
- **"Require SSO" is enforced in the database** (`sso_satisfied` inside
  every membership helper, reading the session's `amr` claim), so a
  password session can't reach the workspace through the API either.
  The owner is exempt: a misconfigured or down identity provider must
  not lock a workspace out of itself. A member locked out this way is
  sent to "Log in with SSO" instead of being given an empty personal
  workspace.
- **SSO sign-ins join on arrival** (just-in-time), with the default
  role, within the plan's seats.
- **SCIM (P3.18) lists who may join; it doesn't create accounts.**
  Supabase never links an SSO sign-in to an existing account with the
  same email, so an account created ahead of time would be a different
  user from the one who later signs in. `scim_users` is therefore the
  workspace's directory: a listed, active person becomes a member at
  their first SSO sign-in; deactivating or deleting them removes the
  membership of every account with that email (never the owner) and
  blocks rejoining. Users only — no Groups; roles stay in FormCraft.
- **Compliance (P3.17) is tooling plus an honest description, with no
  claims.** Privacy requests (find / export / erase by email) and
  `docs/compliance.md`, which lists the controls that exist, what's
  missing, and states plainly that FormCraft holds no certifications.
  The lookup matches an answer that is exactly the address (any
  question type) or a contact step's email — not addresses mentioned
  inside longer answers. The audit log records that a request was
  handled and how many responses, never the address.
- **Not verified end to end:** a real SAML sign-in. Local Supabase has
  no identity provider, so the sign-in redirect, the `amr` claim on a
  real SSO session and the `sso:<id>` provider metadata are implemented
  from Supabase's documented behaviour and tested with constructed
  values; they need one real provider (Okta/Entra developer tenant) to
  confirm.

## 2026-10-03 — Phase 3, Wave B: AI over responses, copilot, follow-ups

- **The model reads; code decides and stores.** Sentiment, tags and lead
  scores (P3.4–P3.6), summaries (P3.3) and copilot suggestions (P3.2)
  never change a response or a form by themselves. Analysis lives in its
  own tables beside the responses; a copilot rewording is applied only
  when the creator clicks Apply, and then goes through autosave's normal
  validation.
- **Creator-started, one credit per call.** Nothing is analysed in the
  background: "Analyze new responses" does up to 20 per click (one
  credit each, stopping when the plan's credits run out), a summary is
  one credit, a review is one credit. Editors who can see responses can
  run them; reading follows `view_responses`.
- **Data minimisation.** Sent to the model: question labels and written
  answers. Not sent: file uploads, email and phone answers, and from a
  contact step only the company. A free-text answer can still contain
  personal details the respondent typed — creators should say so in
  their privacy notice if they use these features.
- **Answers are data, not instructions.** Every prompt says so and
  wraps respondent text in tags; replies are constrained by a JSON
  schema and re-validated (enums, lengths, tag normalisation, scores
  clamped 0–100 and dropped without criteria).
- **Quotes are verified.** A summary's quotes are kept only if they
  appear word for word in a response it was given (ignoring case and
  spacing); the rest are dropped rather than shown as something a
  respondent said.
- **Lead scoring is the creator's criteria in words** (per form), giving
  a 0–100 score with a one-sentence reason. It sits beside the
  deterministic scoring from the logic engine, never replacing it.
- **Follow-ups (P3.7)** are a per-question switch on long-text
  questions. One optional follow-up per question, at most 3 per
  response, asked once (a refresh returns the same question), with an
  8-second limit and no retries. Any failure — no key, no credits, slow
  or refused model — just means no follow-up; the form never waits or
  errors. They are stored in `response_followups`, not as answers, so
  the form's questions, validation, logic and exports are unchanged.
  The model is told not to ask for personal details. Off when the form
  doesn't save answers before submit (nothing is sent early then).
  They cost the workspace a credit each, so a busy form can use its
  credits up; then follow-ups simply stop.
- **Tested without a model:** a stand-in Messages API for unit,
  integration and E2E (`ANTHROPIC_BASE_URL`; the E2E config always
  overrides it so a real key can't reach the real API from tests).
  **Not yet run against the real model** — there is no key on this
  machine, so prompt quality is unverified.

## 2026-10-03 — Phase 3, Wave A: history, audit, permissions, API, insights, A/B tests, 2FA

- **Version history (P3.10):** restoring copies an old version into the
  draft; it never changes what's live or which version a response
  belongs to. Publishing records who published.
- **Audit log (P3.14):** server-written only (service role, no write
  policies), readable by owners and admins, never containing secrets or
  answers. Writing an entry never fails the action it records.
  Account-level events (2FA) are written to every workspace the person
  belongs to.
- **Granular permissions (P3.15):** per-member overrides on top of the
  role (owner/admin always have everything), enforced in RLS through
  `has_permission`, so hiding responses from someone hides them in the
  API and storage too — not just in the UI. Publishing goes through the
  service role, so the publish actions check `publish` explicitly (a
  viewer could publish before this — found while building it).
- **Retention (P3.16):** a workspace-level window for completed
  responses (7 days to 10 years, or keep), purged by the daily cron and
  logged. Unfinished responses keep their per-form setting.
- **API (P3.11):** scopes per key, cursor pagination
  (`completed_at|id`, base64url), a single error shape and an additive-
  only v1 policy (`docs/api.md`). The responses endpoint changed shape
  to `{ data, next_cursor }` — acceptable now because the API hasn't
  been listed publicly yet.
- **Conversion insights (P3.8)** are rules over counts, not a model:
  the bottleneck question (≥30% of drop-offs, needs 5 abandoned
  sessions), required questions losing more than their share, and
  traffic sources ≥15 points from the overall rate (needs 10 starts in
  each of two sources). Below those thresholds it says there isn't
  enough data rather than reading noise.
- **A/B tests (P3.9)** compare two published forms (A's link sends a
  share of new visitors to B) rather than two versions of one form —
  keeps "published versions are immutable" and "a response belongs to
  one version" intact, and each arm's analytics stay its own form's.
  Assignment is a SHA-256 hash of the experiment and a random first-
  party visitor cookie (`fc_vid`, set by the proxy, `SameSite=None;
Secure` on HTTPS so embeds keep it). Browsers that block third-party
  cookies in embeds may see a different arm per visit; that only adds
  noise and is noted here. Results use a two-proportion z-test on
  completion rate, shown only after 100 starts per arm; nothing is
  declared before p < 0.05 and the system never picks a winner itself.
  Choosing B copies B into A's draft for review — it doesn't go live
  until published. Resume links skip the split (they carry their own
  form's slug). Plan: Business and up (`ab_testing`).
- **2FA (P3.13):** Supabase TOTP, enforced in the database
  (`mfa_satisfied()` in a restrictive policy on every table and in the
  membership helpers), because a password alone gets an `aal1` token
  that could otherwise be used against the API directly. The app also
  redirects to `/two-factor` (proxy + `requireUser`) and the login
  action goes there itself so the address bar is right. Recovery codes
  are ours (10, SHA-256, one use each) rather than Supabase's
  experimental recovery-code factor; using one removes the authenticator
  (to be set up again) instead of being a standing bypass. Turning 2FA
  off needs a current code. Verification attempts are rate-limited.
  **Production:** enable TOTP under Authentication → MFA in the
  Supabase dashboard (local: `[auth.mfa.totp]` in `config.toml`).

## 2026-10-02 — Wave 5: scheduling, languages, HubSpot, Stripe

- **Scheduling (P2.16)** as a booking page on an ending (Calendly or
  Cal.com hosts only), prefilled with the respondent's name and email and
  tagged with the response id (Calendly `utm_content`, Cal.com
  `metadata[formcraftResponseId]`) so a booking can be traced to the
  answers that qualified it. A booking page stops the automatic redirect.
- **Languages (P2.21):** translations keyed by the same ids (so logic,
  answers and analytics are shared), falling back to the original text;
  the respondent picks from a switcher, else `?lang=`, else the browser.
  FormCraft's own words are translated for 11 languages (English where a
  string is missing); server-side validation messages stay English for
  now. Arabic renders right-to-left. Responses record their language.
  Without the plan the live form shows only its own language (the
  builder still lets you prepare translations).
- **HubSpot (P2.15)** with a private-app token instead of an OAuth app
  (no HubSpot app registration needed; the PRD's "reconnect expired
  authorization" becomes: a 401 marks the connection invalid and Settings
  asks for a new token). Explicit field mapping; email required; contacts
  updated by email, else created; uploads never sent. Deliveries use the
  webhook queue, so failures retry and show in the log.
- **Stripe (P2.17)** with the workspace's own keys (secret or restricted
  key + webhook signing secret, both checked/encrypted) rather than
  Stripe Connect, which needs a platform account. Checkout only (no card
  data here); amount fixed or from a number variable, computed on the
  server from the saved response; status only from the signed webhook or
  a server-side session check; answers saved before payment; paid never
  regresses and isn't charged twice. Refunds stay in Stripe (as the PRD
  allows). Payment settings live on the form (like pixel IDs), not in the
  versioned schema, so they apply to the live form immediately.
- **Found while testing:** Zod 4 records with enum keys are exhaustive
  (would have demanded every language) — switched to `partialRecord`;
  the payment retry built an https return URL on an http host — it now
  uses the request's own origin.
- **Not live-verified:** real Stripe, HubSpot, Calendly and Cal.com need
  the user's accounts. Everything is tested against fakes (fake Stripe
  server with a Checkout page in E2E; fake HubSpot API in integration).

## 2026-10-02 — Wave 4: confirmation emails, pixels, popup embeds, Zapier/Make, Slack

- **Confirmation emails (P2.18)** can't become a mail cannon: the
  recipient is only the address the respondent typed into the form's
  chosen email question; at most one per response (a log row is claimed
  before sending); none for spam-flagged responses; 500 per form per day.
  The creator writes plain text with recall; it's escaped into the
  standard layout, and the subject is kept to one line. Sent after the
  response is saved, like the owner notification; needs Resend.
- **Pixels (P2.12):** GA4, GTM and Meta Pixel by ID only, checked
  against their exact formats in the database and again before going
  into each vendor's standard snippet. Live form only, and only on a
  plan with them. Events: page view, start, submit — never answers. The
  panel tells creators these set cookies and may need consent; FormCraft
  doesn't show a consent banner for them (the creator's site/policy
  decides).
- **Popup / side-tab / button embeds (P2.23)** are one self-contained
  script per embed, rendered in a shadow root (no style clashes either
  way, no globals), with Escape, a close button, focus return and scroll
  lock. The plan gate is on offering the code (it runs on the creator's
  site, and anyone could build their own popup around a public link).
  Testing caught focus not returning from inside the shadow root — fixed.
- **Zapier / Make (P2.13)** use workspace API keys (Business) and REST
  hooks that are ordinary signed webhook endpoints, as the PRD asks
  ("reuse webhook infrastructure"). Publishing a Zapier/Make app listing
  is an external step; the endpoints it needs exist and are documented
  in docs/api.md. The same keys are the base of the public API (P3.11).
- **Slack (P2.14)** by incoming webhook rather than an OAuth app: the
  channel is chosen in Slack when the webhook is made, no Slack client
  secret is needed, and deliveries ride the webhook queue. Messages show
  the chosen answers (up to ten) and a link to the response; uploads are
  never linked.

## 2026-10-02 — Wave 3: branding, fonts, custom domains

- **Badge (P2.1):** the existing per-ending switch stays, but it only
  takes effect when the plan includes `remove_branding`. The server that
  renders the public form decides; the builder disables the switch with
  a note. Grandfathered workspaces keep no badge.
- **Fonts (P2.22):** five more Google fonts (Poppins, Lora, Playfair
  Display, Nunito, DM Serif Display) self-hosted by next/font and not
  preloaded, plus uploaded WOFF2 fonts (≤ 2 MB, signature-checked,
  licence confirmation required, stored in the workspace's theme
  folder). The server swaps any paid font for Inter when the plan lacks
  `custom_fonts`. An uploaded font's CSS uses a fixed internal family
  name and only a URL in our own storage, so neither the name nor a
  crafted URL can inject CSS or make respondents' browsers call a
  third-party server.
- **Custom domains (P2.2):** ownership by a TXT record
  (`_formcraft-challenge.<host>` = `formcraft-verify=<token>`), traffic
  by CNAME to the app. Only verified domains are routed; the proxy looks
  them up through a definer function (no service key in the proxy) and
  caches for a minute. A domain serves only its workspace's published
  forms (`/` = chosen default, `/<slug>` = any of them) and the
  respondent API — never the app, so no sign-in cookies on customer
  domains. Re-checked every 30 minutes: a domain whose record vanished
  goes to "error" and stops routing. TLS is the host's job: with Vercel
  credentials the app adds the domain to the project (which issues the
  certificate); otherwise the domain must be added on the host by hand.
- **Not live-verified here:** real DNS and certificate issuance need a
  public domain and the hosting account; the flow is tested with a fake
  resolver, a fake Vercel API and `*.localhost` routing in the browser.

## 2026-10-02 — Wave 2: teams and folders

- **Four roles (P2.19).** Owner (the workspace's creator, exactly one),
  Admin (everything but ownership and deleting the workspace), Editor
  (what every member could do before — existing members are editors,
  unchanged), Viewer (reads forms, responses, analytics; changes
  nothing). Enforced in row-level security, not just the UI.
- **Viewers get view-only screens,** not failing saves: the builder,
  Settings and Integrations send them to Responses; tabs, form menus,
  New form and delete buttons are hidden; a "View only" label shows.
- **Invitations** are links (7 days, one email address, hashed tokens).
  When Resend is set up they're emailed; either way the admin gets the
  link to share. Accepting requires being signed in with the invited
  address. A new account created from an invitation returns to it after
  confirming its email (signup now carries a safe `next`).
- **Seats** come from the plan (`members`) and count open invitations,
  so a workspace can't over-invite and accept later. Free has one seat,
  so inviting needs a paid plan (seeded data; editable).
- **Several workspaces:** a member of more than one switches in the
  sidebar menu. The choice is a cookie preference, re-checked against
  membership on every request.
- **No ownership transfer yet** — the owner can't leave or be demoted;
  transfer needs its own flow (and billing ownership) to be safe.
- **Folders (P2.20)** are flat (no nesting) and per workspace. Deleting
  one moves its forms out; the confirmation says so. Dashboard filters:
  folder, status, search and "Created by me".
- **Found while testing:** the owner-only member policy was what let a
  new user's first workspace get its owner row — kept alongside the
  admin policy. And teammates couldn't see each other's names (profiles
  were self-only), fixed with a shares-a-workspace policy.

## 2026-10-02 — Wave 1: redirects, resume links, randomness, carry-forward

- **Redirect after submission (P2.9).** The ending's redirect wins, else
  the form's default (new, https only). Delay 0–30 s, 3 by default — the
  countdown the live form already had, so existing forms are unchanged.
- **Resume links (P2.8)** are off per form until the creator turns them
  on, and need "save answers as people go". The respondent gets the link
  on screen to copy (no email: "Email me a link" stays out, see the UI
  entry). 30-day expiry; completing revokes; republishing makes old
  links start fresh ("the form has changed") rather than mix versions.
  A link that no longer works also discards this browser's copy of that
  session, as its note says.
- **Randomness is a per-response seed** made in the browser and stored
  at start. Pools and option order are drawn from it, so the browser and
  the server's walk agree and a refresh doesn't reshuffle. A respondent
  could choose their own seed; that only chooses among questions the
  creator pooled, so it isn't treated as a security boundary. Old
  responses without a seed replay with an empty seed.
- **Carry-forward copies options.** Rather than resolving options at
  every read (exports, charts, logic UI, analysis), the builder keeps
  the carried question's options a copy of the source's ids and labels
  and the analyser enforces it. Points and "correct" stay the carried
  question's own so a pick isn't scored twice. If the source question
  loses an option a rule on the carried question uses, that rule shows
  in Check as broken, as it would for any removed option.
- **Not built in this wave:** options from an external data source
  (that is "external API data", logic spec phase 24, with SSRF and
  secret handling to design) and adaptive assessments (phase 20).

## 2026-10-02 — Phase 2 starts: defaults, and Wave 0 (plans and usage)

The user asked to build all remaining phases, starting with Phase 2.
The defaults proposed in the Phase 2 plan apply:

- **Order:** Wave 0 foundations → 1 conversion → 2 teams → 3 branding
  and domains → 4 outbound → 5 external (status: `PROJECT_STATUS.md`).
- **Plans without checkout.** Entitlements are modelled and enforced;
  plans are assigned by `npm run plan:set` (service role). FormCraft's
  own subscription billing isn't in the PRD's Phase 2 list and can plug
  into `workspaces.plan_id` later.
- **What each plan includes** is seeded data in `plans` (editable
  without a deploy): Free keeps everything Phase 1 offered plus logic,
  hidden fields, redirects and recall; Pro adds badge removal, fonts,
  confirmation emails, popup embeds, pixels, multilingual, scheduling;
  Business adds seats, custom domains, Slack, CRM, payments, API.
- **Nothing existing gets worse.** Workspaces created before plans get
  overrides keeping no badge and the 100 MB file ceiling Phase 1 allowed.
- **Limits never lose submissions** (PRD §8). The monthly response
  limit is soft: responses past it are stored and delivered, and the
  creator sees a banner on the dashboard and in Settings → Plan. Limits
  checked before an action (AI credits; seats, from Wave 2) stop the
  action with a message instead.
- **AI credits are spent before the call** (one per rule draft or
  generated form), so a failing call still costs a credit; simpler and
  can't be raced past the limit. Free gets 20 a month.
- **Counting:** completed responses by a database trigger (once per
  response, whatever the client retries); the current month was
  backfilled in the migration.
- **Outside accounts** (custom-domain TLS, Slack, HubSpot, Stripe,
  scheduling, Resend) are built against adapters with test doubles and
  verified locally; live checks wait for keys.

## 2026-10-02 — AI-assisted logic and forms: the model proposes, code decides

- **Flat drafts, not the AST.** Structured outputs can't express
  recursive schemas, and a model writing ids is error-prone. The model
  fills a flat draft (questions by number, options by label, variables
  by name, values in words); `draftToRule` / `buildGeneratedForm`
  translate it deterministically and the result must pass the same Zod
  schema and `analyzeLogic` as hand-made logic. One level of All/Any.
- **Nothing is applied automatically.** A rule proposal is shown in the
  builder's own words with any new variables and warnings; the creator
  adds or discards it, and autosave validates it again. A generated form
  opens as an ordinary unpublished draft.
- **One repair round** for rules: a draft that doesn't translate is sent
  back with the exact problem once; then the problem is shown.
  Generated forms drop rules that don't fit and say so instead of failing.
- **Our own JSON schema.** `@anthropic-ai/sdk` 0.131's zod helper moves
  `enum` into the description, so values would be suggested, not
  enforced; `output-format.ts` builds the schema from Zod and keeps
  enums, and replies are validated with the full Zod schema.
- **Model and safety.** `claude-opus-5-5`, effort medium, server-side
  fallbacks on. Server-only key (`ANTHROPIC_API_KEY`); without it the UI
  says AI isn't set up. Rate-limited per user (30 rule drafts, 10 forms
  per hour, shared Postgres limiter), form ownership checked, input
  length capped. Form content sent to the model is the creator's own.
- **Tested without a model:** translators by unit test; the request
  shape, repair loop and refusal handling against a stand-in Messages
  API (`ANTHROPIC_BASE_URL`). Not yet run against the real model here
  (no key on this machine).

## 2026-10-02 — Summary "Results": replay, don't store

Endings come from `responses.ending_id`; variables are replayed per
response with the form version it was served, its URL values and its
submission time (same as the response detail and webhooks), so no
derived value is stored as truth. Capped by the Summary's existing
2,000-response limit. Ending titles show recall tokens by name.

## 2026-10-02 — Logic engine: one model, additive schema

Asked for explicitly (a full logic/scoring engine), which goes beyond the
Phase 1 scope rule in CLAUDE.md; the request overrides it, and the work
follows the other rules (server authoritative, immutable versions,
stable ids, deterministic runtime). Design: docs/logic-engine.md.

- **Additive to `FormSchemaV1`, no v2.** Variables, rules, hidden fields,
  `visibleIf`, `validations`, option `scores`/`correct` and `weight` are
  optional fields, so every stored draft and published version parses
  and behaves exactly as before.
- **One engine.** Legacy `logic` rules are translated into the rule
  model at evaluation time (`legacyToRule`) instead of being migrated in
  the database; `evaluateNextStep` / `walkForm` keep their signatures
  and now run through it. All pre-existing logic tests pass unchanged.
- **Evaluation order:** legacy rules, then `rules`, in array order; every
  matching rule's variable actions run, the first matching navigation
  wins (the legacy "first match wins"); hidden questions are skipped and
  never required; completion rules run last and only pick the ending if
  a question rule didn't.
- **Variables are derived, not stored.** They're recomputed by replaying
  the answers along the path (client while answering, server at
  submission), so they can't drift or be forged. Date logic uses a
  pinned clock and the form's timezone (UTC by default).
- **No formula variables.** Variables change only through ordered
  actions, so dependency cycles can't exist; jumps stay forward-only, so
  navigation cycles can't either.
- **Expressions are a typed AST** with a whitelist of functions;
  evaluation is total (bad types, ÷0 and NaN become null).
- **Static analysis** (`analyzeLogic`): broken references, backward
  jumps, type mistakes and ÷0 are errors that block saving;
  contradictory conditions, shadowed rules and required-but-conditional
  questions are warnings.
- Integration tests now run one file at a time: the webhook, Sheets and
  health tests sweep shared job queues and were interfering in parallel.

## 2026-10-02 — New UI ("Index Card" handoff): where we followed it and where we didn't

The design handoff (`design_handoff_formcraft`, Parts 1–8) is the visual
source of truth. Where a board shows something the product doesn't do,
or would need new backend work, the simplest production-safe option won:

- **Form sections.** Responses, Integrations, Settings and Share sit in
  the app frame under a `(sections)` route group; only the builder is
  full-screen. The boards show Build · Responses · Integrations tabs;
  **Settings** is kept as a fourth tab (it holds unfinished-response
  retention and the public link). **Share** is the builder's Share
  popover (link, QR, embed) plus the existing Share page, reached from
  the popover and from a Share button on section pages.
- **Embed modes.** Standard (the existing auto-resizing iframe) and Full
  page. The board's **Popup** embed is left out: it needs a hosted
  script we don't ship.
- **Responses filters.** Date range, ending and "filter by answer" (choice
  and yes/no questions, matched with jsonb containment on `answers`) are
  built, live in the URL, and also apply to CSV export so the file
  matches the table. **"Search answers" is not built**: free-text search
  over jsonb answer values isn't possible through PostgREST without a
  schema change (a search column or function), which is out of scope for
  a UI pass.
- **Summary view.** Per-question charts over completed responses, read
  from the newest 2,000 matching responses (the page says so when
  capped) so one view can't scan an unbounded table.
- **Email notifications.** Moved to the Integrations page in the board's
  style. Still the existing owner-only on/off: the board's extra
  recipients and **Daily digest** would need new storage and a scheduler,
  so they aren't shown.
- **File upload types.** The builder offers Images and PDF only — the two
  types the server can verify from file bytes. The board's "Documents"
  and "Any file" chips aren't offered. Max size stays 1–100 MB (schema),
  not the board's 25 MB.
- **Phone default country.** Kept as a two-letter code field (what the
  schema stores), not the board's dial-code dropdown.
- **"Made with FormCraft".** Kept on endings, with a per-ending switch.
- **Builder below 1024px** shows the "best on a bigger screen" state with
  Preview, Share link and Responses. The board's "Email me a link"
  action isn't built (no such email exists).
- **Button text on the theme colour.** The handoff picks white unless the
  primary is very light (luminance > 0.45). That puts white on Sunset
  orange (≈3.3:1) and Midnight lavender (≈2.2:1), both below WCAG AA for
  button text, and the accessibility gate caught it. Respondent buttons
  now use whichever of white or near-black contrasts more, the same rule
  the dashboard's form previews already used; Classic, Ocean and Forest
  are unchanged.
- **Builder side panels** are 280 / 300px, per the README and Part 8's
  wide-screen rules (the Part 4 board draws 340).
- **Notification email + Supabase auth emails** share one 600px,
  table-based layout (`src/domains/notifications/email-layout.ts`).
  `npm run emails:build` writes the Confirm and Reset templates into
  `supabase/templates/` (wired in `supabase/config.toml`; they still need
  pasting into the hosted project). They keep `{{ .ConfirmationURL }}`,
  so the auth links work exactly as before.
- **Select values on first load.** Radix only fills a closed select's
  label after its menu has opened once on server-rendered pages; our
  `Select` wrapper now passes the selected item's label to `SelectValue`
  so a page loaded with a value shows it.

## 2026-10-01 — Hardening round: what was decided and why

Found by a creator/respondent walkthrough plus two independent reviews;
each item below was reproduced (or proven by a failing test) before it
was fixed. Anything here that contradicts an older entry replaces it.

**Respondent data**

- **Unfinished-looking submissions (a reported bug).** The spam trap was
  named like a real field and autofilled; the server then "succeeded"
  without completing. Now: the trap is meaningless-named and excluded
  from autofill, and a filled trap **flags** the response
  (`spam_suspected`, no notifications/webhooks/Sheets) but keeps it.
  _Replaces the 09-30 "fake success and nothing completed" rule._ The
  root cause for the reporter was inferred from the data and mechanism,
  not observed; the E2E test reproduces it.
- **Writes are atomic and validate-first.** Autosave and completion are
  single database functions; a rejected submission writes nothing, even
  on forms that don't keep unfinished answers. File answers must be real
  clean uploads of that response and question; only the upload id is
  stored.
- **Cleared answers are deleted**, not stored as empty values, so
  "answered" means the same everywhere (logic, exports, drop-off).
- **Funnel:** views come from events, starts and completions from
  `responses` (by start date), so the three numbers describe one cohort.
  Bots and the form's own workspace members don't count as views.

**Tenancy and abuse**

- Tenant-takeover paths closed (self-granted owner row, public reads,
  client-callable publish); see migration 18 and `rls-isolation.test.ts`.
- **Client address:** the first `X-Forwarded-For` entry is visitor-
  written, so it is never trusted. `CLIENT_IP_HEADER` or the
  `TRUSTED_PROXY_HOPS`-th entry from the right is used (`src/lib/http/ip.ts`).
- `/start` allows 120 per 10 minutes per address + form: a school or
  office shares an address and each respondent starts once.
- A failed start isn't retried on every answer (5 s cooldown); submitting
  always retries.
- Google OAuth `state` is signed and bound to user, form and a cookie.
  Spreadsheet cells that start with `= + - @` are neutralised.

**Integrations**

- Webhook and Sheets jobs are created idempotently (unique per
  endpoint/connection + response), claimed with `FOR UPDATE SKIP LOCKED`
  and a lease, isolated per job, and recovered by a 24-hour sweep if the
  post-submit callback died. A disabled endpoint's jobs end as
  `exhausted`, never silently pending.
- **`/api/cron/health`** reports overdue jobs and stuck uploads for an
  external monitor. Jobs that gave up are reported but **don't** make the
  status "degraded": a creator's endpoint being down is theirs to fix;
  overdue jobs mean our workers stopped.

**Forms and logic**

- **Jumps only go forward.** Back-jumps loop (the old static check
  accepted them). Enforced in the builder and server-side; forms
  published earlier are protected by a runtime visited-set instead of
  being unpublished. Details in `docs/form-schema.md`.
- Rules must name real options; deleting an option deletes the rules
  that checked it (with a notice); a reorder that would create a
  back-jump is refused rather than rewriting the creator's logic.
- A half-built rule can be saved as a draft but not published.
- Contact blocks and uploads only offer "is answered"; multi-select
  offers "contains" (its answer is a list, so "is" could never match).
- Duplicating a form keeps its unfinished-response settings.

**Creator surfaces**

- **Share page lead capture** says what respondents get — live version,
  and whether unfinished responses are saved — not just whether the
  draft has a contact step.
- Phone menu is a real modal dialog (Escape, focus trap, focus return).
- When a question changes, focus moves to its heading unless a text box
  took it, so keyboard and screen-reader users aren't dropped at the top
  of the page.
- Embed snippet trusts only messages from its own iframe about its own
  form and clamps the height; it no longer compares origins.
- Colour tokens `--muted-foreground` and `--destructive` darkened to pass
  WCAG AA on tinted backgrounds (axe found them).
- Email change: Supabase confirms from **both** inboxes
  (`double_confirm_changes = true`), and the message says so. If a
  deployment turns that off, change the wording in
  `settings/actions.ts`.

**Data lifecycle**

- Storage cleanup (retention, response delete, account delete, form
  purge) pages through every file; PostgREST silently stops at 1000 rows.
- Leads are listed, searched and counted in SQL (`list_leads`) so totals
  are exact and each lead appears once; export is capped at 10,000 rows.

**Deliberately not done**

- No malware scanner (needs a service); uploads are type-sniffed, size-
  capped, private and never served inline.
- No automated Google Sheets reconnect E2E: it needs a real Google OAuth
  client. The pieces around it (state, formula neutralisation, workers)
  are tested.

## 2026-09-30 — PRD gap closure: definitions and defaults

Decisions made while aligning v0 with the PRD (Phase 1 + P2.7):

- **A start is the first interaction** (pressing Start, typing,
  choosing), matching the PRD's definition. The response row is created
  then, not on page load — so Starts no longer equal Views.
- **Partial = at least one saved answer.** Moving past the welcome
  screen alone keeps a response `in_progress` (it still counts toward
  drop-off at the first question).
- **Abandoned after 30 minutes idle** (user-confirmed), derived from
  `last_active_at` at read time; nothing stored, so the threshold can
  change freely (`ABANDONED_AFTER_MINUTES`).
- **Saving unfinished answers is on by default, with a respondent
  notice.** Creators can turn it off per form (server-enforced) and set
  automatic deletion after 30/90/180/365 days (daily cron). No
  "lead didn't finish" alert yet — not in the PRD; revisit on demand.
- **Spam:** hidden honeypot field; a filled one gets a fake success
  and nothing is completed/notified. Rate limits moved to Postgres
  (`hit_rate_limit`) so they hold across instances, falling back to the
  in-memory limiter if the database call fails.
- **Events (PRD §3.6):** creator events recorded server-side; respondent
  `question_viewed` / `question_answered` via a rate-limited endpoint.
  Ids and small metadata only — never answer values.
- **Uploaded files / malware (PRD P1.5):** no scanner yet. Mitigations
  in place: server-side size limit, magic-byte type sniffing, private
  bucket, access only via short-lived signed URLs. A scanning service
  (e.g. ClamAV or a vendor API) is required before handling untrusted
  uploads at scale — tracked as a production-readiness item.
- **Question type change:** keeps id/text/required; text-like types
  keep placeholder/length, choice types keep options; otherwise settings
  reset. Logic rules that no longer fit are removed, after a warning.
- **Account deletion** is immediate and permanent (workspaces, forms,
  responses, uploaded files, auth user), confirmed by typing the email.
- **Embeds** use `?embed=1`: views and responses are flagged as
  embedded, and the form reports its height so the iframe resizes.

## 2026-09-30 — Lead capture is a question type, placed before the last question

Requested directly by the user (it overrides the Phase 1 scope rule for
this feature): capture a respondent's contact details _before_ the
final question, so the lead is kept even if they never submit.

- Modelled as a `contact_info` question type rather than a form-level
  toggle: it reuses autosave (the answer is persisted the moment the
  respondent moves past the step), validation, logic (`is answered`),
  response views and exports with no parallel pipeline.
- New blank forms include it (welcome → open question → contact info →
  optional last question). Any form gets it via "Add lead capture",
  which inserts it just before the last question.
- A "lead" is any response with non-empty contact details, finished or
  not. The workspace Leads page lists them across forms.
- Fields: name, email, phone, company — each toggleable and requirable.
  Consent text / CRM sync are deliberately not included.

## 2026-09-30 — "Incomplete" means answered something but didn't submit

The Responses page splits into Completed and Incomplete. Incomplete is
status `partial` (at least one saved answer). A visitor who opened the
form and answered nothing (`in_progress`) isn't listed — there's
nothing to show — but still counts as a Start in the funnel.

## 2026-09-30 — App navigation structure

Workspace pages (Forms, Leads, Templates) share a sidebar shell. Pages
inside a form (Build, Share, Responses, Integrations) share a top bar
with those four tabs and no sidebar, so the builder keeps full width.
Brand colour is a single token set in `globals.css`; published forms
never inherit it (their own theme re-points the tokens).

## 2026-09-30 — Welcome screen is optional and pinned first

The builder refused to delete the welcome screen yet allowed
duplicating it and moving it mid-form. Chosen rule: at most one, always
at index 0 (not movable, not duplicable, nothing moves above it), but
deletable — and re-addable from "Add question", which inserts it at the
top. Enforced in `src/domains/forms/builder.ts` so the UI can't drift.
A form must keep at least one question (schema minimum), so the last
remaining question can't be deleted.

## 2026-09-30 — Webhook loopback only outside production

Loopback webhook URLs (`localhost`, 127/8, `::1`) had been allowed
everywhere "for local development", which in production lets a
creator aim server-side requests at the app host itself. They're now
allowed only when `NODE_ENV !== "production"`; plain `http:` likewise
only for `localhost` in development. Deliveries never follow
redirects, and hostnames are DNS-resolved and rejected if any address
is private. DNS rebinding between check and connect remains possible;
closing it needs connection-level IP pinning — deferred.

## 2026-09-30 — Creator-supplied URLs must be http(s)

Ending redirect, logo and background image URLs were `z.string().url()`,
which accepts `javascript:`/`data:`. Restricted to `http(s)://` in the
schema (the server's authoritative check) rather than relying on React
neutralising `javascript:` hrefs.

## 2026-09-30 — Emailed auth links go through /auth/confirm

All Supabase email links (signup confirmation, password recovery)
redirect to `/auth/confirm?next=…`, a route handler that completes the
PKCE code or token-hash exchange server-side and continues to a
same-origin `next`. Deployments must list `<origin>/auth/confirm` in
Supabase's allowed redirect URLs (README → Deploying).

## 2026-09-29 — forms.slug had to become globally unique, not just per-workspace

Writing the first real E2E test (Playwright, multiple workers running
in parallel — the exact condition that surfaces this) found that
`/f/[slug]` 500'd with `PGRST116: "multiple rows returned"` the moment
two different workspaces each had a form titled "Untitled form" — the
literal default title every new form starts with, so this isn't an
edge case, it's close to the default outcome for two customers who
haven't renamed their first form yet. Root cause: `forms.slug` was
only unique _within_ a workspace (`unique(workspace_id, slug)`), but
`getPublicFormBySlug` — the query backing the public respondent
URL — looks a form up by slug alone, with no workspace in the URL to
disambiguate. Nothing in the URL scheme ever promised global
uniqueness, but the lookup query assumed it.

Fixed by making `forms.slug` globally unique (migration
00000000000012), matching `workspaces.slug`'s own design rather than
inventing a second scheme (e.g. `/f/[workspaceSlug]/[formSlug]`, a
bigger URL/UX change for no real benefit here).
`createFormWithDraft` already retries with a `-1`/`-2`/... suffix on
any "duplicate key" error — that logic was written with same-workspace
collisions in mind, but works identically for cross-workspace ones
once the constraint actually raises that error, so no app-code change
was needed beyond the migration itself (which also normalizes any
pre-existing cross-workspace duplicate slugs before adding the
constraint, so it's safe to run against a database that already has
one). This is the clearest illustration this session produced of why
E2E tests matter as a distinct layer: every integration test uses a
single workspace and would never see this; it only shows up under
real concurrent multi-tenant usage, which is exactly what E2E-with-
parallel-workers exercises and unit/integration tests structurally
cannot.

## 2026-09-29 — Auth-page-redirect middleware needs exact paths, not prefixes

Also found by the first real E2E run: `/signup/check-email` (and
`/forgot-password/check-email`) redirected straight to `/dashboard`
for a just-signed-up user, so the "go check your inbox" instructions
were never seen by the person who most needed them. Root cause:
`updateSession` (`src/lib/supabase/middleware.ts`) redirects an
already-authenticated visitor away from "auth pages" via
`AUTH_PREFIXES.some(p => path.startsWith(p))` — `/signup` as a prefix
also matches `/signup/check-email`. Whether this bites in production
depends on the Supabase project's email-confirmation setting: with
confirmations required (the normal production setting), `signUp()`
returns no session and the bug is dormant; with autoconfirm on (this
local dev environment's default, and possibly some deployments'), a
session exists immediately and the check-email page becomes
unreachable for the exact person it's for. Fixed by matching the four
real auth-entry paths (`/login`, `/signup`, `/forgot-password`,
`/reset-password`) exactly rather than as prefixes, so their own
"check your email" sub-pages are excluded from the redirect-away rule
without needing special-cased exceptions.

## 2026-09-28 — Autosave/complete now filter answers against the real schema, not just Zod's shape check

Adversarial testing (live curl against the running app, part of this
session's security pass) found that `saveResponseAnswers` and
`completeResponse` both wrote whatever `question_id` keys a client
sent straight into the `answers` table, with zero check against the
form's actual published schema. Zod's `z.record(z.string(),
z.unknown())` on the request body validates _shape_ (it's an object of
string keys to arbitrary values) but says nothing about whether those
keys are real — shape validation and schema validation are different
questions, and only the first was being asked. This is a direct
instance of CLAUDE.md rule 1 ("never trust client-supplied ...
schema") — the client fully controls which keys appear in `answers`,
and nothing about that object's shape rules out a forged key.

Impact was contained (garbage keys are invisible to the creator — the
dashboard/CSV export only look up known question ids from the schema,
never iterate the raw `answers` table) but real: unbounded storage
growth tied to the public, rate-limited-but-not-schema-bounded
autosave endpoint (up to 120 requests/10min, each able to define
arbitrarily many distinct garbage keys within the 200KB body cap).

Fixed with one new function, `filterAnswersToKnownQuestions`
(`src/domains/responses/queries.ts`), applied before every write in
both functions — `completeResponse` already had the compiled schema
in scope (no new query), `saveResponseAnswers` needed one extra
indexed lookup (`form_versions` by the response's own
`form_version_id`, already selected for free from the CAS update) to
get it. Chose to silently drop unknown keys rather than reject the
whole request: a legitimate respondent's request always consists
entirely of real keys, so a mix only ever happens from a forged
request, and there's no useful error to surface to an attacker anyway
— silently ignoring is simpler than adding a new "some of your answer
keys were invalid" error path nothing legitimate would ever trigger.

## 2026-09-28 — The builder's editing surface is desktop-oriented by design; respondent/dashboard pages are fully responsive

The spec calls for "responsive design," which could be read as every
screen in the product working at any width. Walking the app at a real
375px viewport this session found and fixed two genuine bugs (a
dashboard header that ran text together illegibly, a builder toolbar
that overlapped its own back button — both above), but it also
surfaced a bigger, more deliberate question: the builder's 3-pane
layout (question list + center canvas + a right settings panel, each
needing real width to be usable — dragging questions, editing option
lists, previewing theme colors) doesn't fit 375px without either
hiding two of the three panes behind navigation or shrinking each pane
to the point of being unusable for actual editing work.

Chose not to redesign it into a mobile-first editing experience.
Every comparable tool (Google Forms, Typeform, Notion, Figma) makes
the identical split: the _creation_ surface is desktop-oriented, while
the _consumption_/_respondent_ surface is mobile-first — because
editing a multi-panel document is fundamentally a different task than
filling one out, and forcing the former into a phone-sized viewport
produces a worse tool without actually serving the "someone fills this
out on their phone" need, which the public runtime already serves
fully (verified separately at 375px, no changes needed). Applied the
same reasoning to every other creator page (dashboard, responses,
integrations, templates), which all needed to and do work at mobile
width, since checking results or connecting a webhook doesn't need
three panes of real estate the way question editing does. The dividing
line is task-shaped, not "creator vs. respondent" — it's specifically
the dense multi-panel editing canvas that's scoped out.

## 2026-09-28 — Every integration test bypassed RLS, which is how a real RLS bug shipped

Found while live-testing the accessibility/mobile-polish pass (not by
code review): a signed-in visitor got a false 404 on every public form
link at `/f/[slug]`. Root cause was `alter policy ... to anon` on the
two SELECT policies backing that route — Postgres RLS applies a policy
only to the exact role(s) it names, so a logged-in session (querying
as `authenticated`, not `anon`) matched nothing and the page correctly
called `notFound()` on a form that very much exists. Fixed in migration
`00000000000011_public_form_read_for_authenticated.sql`
(`to anon, authenticated`).

The more important finding is _why_ this shipped past a test suite
with 100+ integration tests: every single one of them uses the
service-role client, which bypasses RLS entirely by design (it's how
route handlers run privileged work). That's the right client for
testing domain logic, but it means RLS itself — arguably the single
most security-critical layer in this app (see CLAUDE.md rule 4) — had
zero direct test coverage. This is the same root-cause _class_ as this
session's earlier grants bugs (`authenticated`/`service_role` lacking
table grants on new tables): a gap between "the service-role tests
pass" and "a real user's session actually works," caught both times
only by manually driving the app as a real user rather than by the
automated suite. `tests/integration/public-form-access.test.ts` closes
this specific gap by signing in through the anon-key client (the same
one `createServerSupabaseClient()` constructs) and asserting on what a
real, unrelated authenticated user can and can't read — not a general
fix for the class of bug, but a concrete data point future work in
this area should follow: prefer the anon/authenticated client over the
service-role client whenever a test is really asking "does RLS let the
right people in and keep the wrong people out," not "does the domain
function work."

## 2026-09-28 — Google Sheets: built and verified everything except the OAuth client itself

This environment has no real Google Cloud project, so the actual
`accounts.google.com` consent flow and the real `sheets.googleapis.com`
API can't be exercised end-to-end here — the spec's "don't ship
unverified code" bar could have meant leaving all of Sheets undone
until deploy time. Rejected that as too conservative: everything on
this app's side of the OAuth boundary — token encryption, the
refresh/expiry logic, the sync-enqueue/dispatch/backoff engine, the
connect/disconnect UI, and both OAuth routes — is ordinary code this
environment absolutely can build and verify, and is exactly the part
most likely to have real bugs (token expiry math, encryption
round-tripping, retry scheduling). So `oauth.ts`'s
`exchangeCodeForTokens`/`refreshAccessToken` and `append.ts`'s
`appendRowToSheet` all take an optional endpoint/base-URL override,
letting `tests/integration/sheets.test.ts` spin up a tiny local
`node:http` server that stands in for both of Google's endpoints —
the same "real local receiver, not a mock" rigor the webhooks
milestone used, extended to a domain where the real counterpart isn't
reachable at all. That test proves a genuine token-refresh-then-append
cycle, not just that the code compiles.

The one thing that _can't_ be faked is Google's own `accounts.google.com`
actually accepting a client id — so as a one-time manual check (not
part of the automated suite, since it needs credentials this repo
doesn't have and shouldn't), `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET` were
set to placeholder values and the "Connect Google Sheets" button was
clicked in a real browser. It correctly reached the real Google
endpoint with the right scope/state/params and failed only with
`Error 401: invalid_client` — confirming the code is right up to
exactly the boundary that requires a real registered OAuth client,
which is documented in PROJECT_STATUS.md as the one remaining
deploy-time step, not a code gap.

Token encryption reuses AES-256-GCM keyed off `APP_SECRET` (already
this app's one server-only secret) rather than introducing a second
secret to manage. The sync retry/backoff engine
(`dispatchDueSheetsSyncs`) deliberately imports
`nextBackoffDelayMs`/`isExhausted` from `@/domains/webhooks/backoff`
instead of re-implementing the same bounded schedule a second time —
it's generic over "attempt count → delay," not actually
webhook-specific, and Sheets syncs should back off exactly the same
way webhook deliveries do.

## 2026-09-28 — Templates are seeded via a script that reuses the builder's own schema helpers, not hand-written JSON

A template is just a `FormSchemaV1` sitting in the `templates` table,
and the tempting shortcut was to hand-write 24 JSON blobs directly in
a SQL migration. Rejected that: hand-written JSON has no type checking
and no relationship to the real validation pipeline, so a typo in a
settings field (e.g. `rating.scale` outside the `5 | 10` union) would
only surface the first time a creator tried to load that template in
the builder — exactly the kind of "shipped unverified" the spec's
quality bar rules out. Instead `scripts/seed-templates.ts` builds each
template with the same `createQuestion`/`createOption`/`createEnding`
helpers `src/domains/forms/builder.ts` already exports for the builder
UI itself, then runs every one through the real
`parseFormSchema`/`validateSemantics` pipeline before writing anything
— a broken template fails the seed script, not a creator's first
click. `getTemplateById` re-parses on every read for the same reason
(belt-and-braces against a template ever being hand-edited directly in
the DB into something invalid).

The seed script is idempotent (upserts by title) and lives outside the
migrations directory on purpose: template _content_ (copy, question
choices) is product decisions that will keep changing, unlike schema
_structure_, which migrations own. Re-running the script after editing
a template in the script is the intended workflow, not a one-time
bootstrap.

## 2026-09-28 — Analytics events fire server-side, never from client JS

`form_viewed`/`form_started`/`form_submitted` could have been tracked
with `posthog-js` in the browser, but that means the funnel is only as
reliable as whichever respondents have JS enabled and no ad/tracker
blocker — exactly the population most likely to differ systematically
from the rest, which would make `computeCompletionRate` quietly wrong
in a way nobody could detect from the number alone. Instead all three
events fire from server code that was already going to run regardless
of client JS: `form_viewed` from `/f/[slug]`'s server component
(reached on every request, full stop), `form_started` from
`/api/responses/start` (a response row is never created any other
way), `form_submitted` from `/api/responses/[id]/complete` (same
`after()` callback as the existing notification/webhook work). This
also means `computeFunnelSummary`'s three counts are always internally
consistent with each other and with the response rows themselves,
since they're derived from the same server-side lifecycle instead of
two independently-flaky signals (client beacon vs. server DB write)
that could drift apart under packet loss, a slow client, or a
respondent closing the tab early.

One consequence: `recordAnalyticsEvent` (the Postgres write — the
dashboard's source of truth) deliberately has no `"server-only"`
import, unlike the rest of this codebase's side-effect modules
(`notifications/send.ts`, `lib/analytics/posthog-server.ts`), because
`"server-only"`'s marker throws on _any_ import outside Next's
`react-server` bundler condition — including a plain Vitest run — so a
file that needs one would be unable to be integration-tested directly
the way `webhooks/queries.ts` and `responses/queries.ts` already are.
PostHog capture stays in its own `"server-only"`-marked, deliberately
untested wrapper (`captureServerEvent`), called as a second, separate
step at each of the three call sites rather than folded into
`recordAnalyticsEvent` itself.

## 2026-09-28 — Webhook retry sweep needs an external scheduler

There's no long-running worker process in this deployment model (a
modular monolith on Next.js route handlers), so "bounded exponential
retry" for webhook deliveries can't be a setInterval-style background
loop. Split it in two: the first attempt happens immediately, inline
in the `/complete` request's `after()` callback (covers the common
case — most endpoints are just up); a separate
`POST /api/cron/webhooks/dispatch`, protected by a `CRON_SECRET`
bearer token (never a user session — it fans out real HTTP requests to
creator-configured URLs, so an anonymous trigger would be a real abuse
vector), picks up anything still due later. This requires an external
scheduler (Vercel Cron, `pg_cron`, or any `curl`-on-a-timer) to be
configured at deploy time — documented in the route's own comment and
here rather than assumed. Verified locally by hand: pointed an
endpoint at a genuinely unreachable port, confirmed the first attempt
failed and was recorded with `next_attempt_at` ~1 minute out, forced
it due, and confirmed a direct call to the cron endpoint picked it up
and incremented the attempt count — the sweep does what it's supposed
to, independent of whatever ends up triggering it in production.

## 2026-09-28 — Notifications: owner-only, opt-out, `after()` not fire-and-forget

Three narrower-than-spec choices for Phase 1 email notifications:
owner-only (not every workspace member — simplest useful default,
revisit if multi-member workspaces become real); opt-out via
`notification_settings` (no row = enabled) rather than opt-in, since a
creator who just published a form almost certainly wants to know when
it gets filled out; and the send is scheduled with Next.js's `after()`
rather than a bare unawaited promise. The latter isn't stylistic — a
plain `void someAsyncCall()` in a route handler can be killed by the
serverless runtime the instant the response is flushed, silently
dropping the notification. `after()` is the documented way to keep the
function alive for exactly this "do it after responding" case. Either
way, a notification failure is swallowed internally
(`notifyFormOwnerOfCompletedResponse` never throws) — it must not be
able to affect the respondent-facing result, matching how every other
integration is treated (ARCHITECTURE.md).

## 2026-09-28 — CSV export column set comes from the latest form_version

`buildResponsesCsv` needs one stable set of columns across potentially
many responses that were each submitted against a different historical
`form_version` (a form can be edited and republished many times).
Chose the most-recently-created version's questions as the reference
column set — the closest available proxy for "current" — while still
resolving each response's own cells against _that response's own_
schema (matched by stable question id), so option labels stay correct
even if a question's options changed after that response was
submitted, and a question added later is simply blank for older
responses rather than misattributed to the wrong one.

## 2026-09-28 — `service_role` also needs explicit grants

Same root cause as the `authenticated`/`anon` grants bug from an
earlier milestone, discovered the same way (live testing, not
inspection): this Supabase version doesn't auto-grant table privileges
to _any_ Data API role, including `service_role`. The public response
API route handlers use the service-role admin client precisely because
respondents never hold a session — but bypassing RLS (what
`service_role` does) turned out to be a separate mechanism from having
the underlying SQL privilege at all, and without it every admin-client
query failed with "permission denied for table X". Migration 10 grants
`service_role` full privileges on all current tables/sequences/
functions, plus `alter default privileges` so the same bug can't recur
silently when future migrations add tables.

## 2026-09-28 — Resume doesn't restore Back-navigation history

`PublicFormRuntime` persists `answers` and the current `lastQuestionId`
to localStorage so a refresh resumes at the right question, but not
the in-memory `history` stack `FormRuntime` uses for its Back button
(that would require `FormRuntime` to report history changes through a
new callback too, for a small UX benefit). Accepted as a Phase 1 gap:
after a resume, Back is unavailable until the respondent navigates
forward again in that session. Correctness (resuming at the right
question, with the right answers, not double-submitting) is unaffected
— this is purely a "how far back can you undo" limitation.

## 2026-09-28 — Builder route moved to its own route group

`/forms/[id]` (the builder) started as a child of the `(dashboard)`
route group, so it inherited the dashboard's header/nav layout. The
builder needs a full-screen, chrome-less layout (its own top bar with
save status, question list sidebar, etc.), which a nested layout
cannot opt out of in the App Router — a child route always wraps
inside every ancestor layout. Moved the route to its own `(builder)`
route group, a sibling of `(dashboard)`. Route groups don't affect the
URL (`/forms/[id]` is unchanged), and the proxy's protected-route
matching is path-based (`/forms`, `/dashboard` prefixes), so this was
a pure file-organization change with no behavioral impact on auth or
routing — confirmed by re-running the full build and the live browser
test after the move.

## 2026-09-28 — Row-action buttons must stay in the tab order

The builder's question-list row actions (move up/down, duplicate,
delete) were built with Tailwind's common `hidden group-hover:flex`
pattern to only show them on hover. Testing the actual keyboard path
(not just visually checking hover) showed this was a real
accessibility bug, not just a style choice: `display: none` removes an
element from the tab order entirely, so a keyboard-only user could
never reach these controls at all — including the reorder buttons that
are supposed to be **the** keyboard alternative to drag-and-drop
required by the spec. An element that's `hidden` can't receive focus,
so a `has-[:focus-visible]:flex` fallback intended to reveal it on
focus never fires either (nothing can focus it to trigger that
selector). Fixed by keeping the buttons always in the DOM/tab order
and toggling `opacity-0` → `opacity-100` on hover _or_ focus-within
instead of `display`. Verified via `read_page` (which lists the full
accessibility tree regardless of visual state) that all row-action
buttons are present with correct labels, and via a live click on a
ref-addressed button that reordering actually works.

## 2026-09-27 — `proxy.ts` instead of `middleware.ts`

Next 16 deprecated the `middleware.ts` file convention in favor of
`proxy.ts` (same behavior, renamed export: `proxy` instead of
`middleware`). Followed the framework's own migration guidance rather
than keeping the deprecated name, since this is a from-scratch project
with no reason to carry deprecated conventions forward.

## 2026-09-27 — Explicit Data-API grants required (RLS alone is not enough)

This Supabase version does not auto-expose newly created tables to the
`anon`/`authenticated` Postgres roles by default (see the
`auto_expose_new_tables` note in `supabase/config.toml` — this is the
new default across Supabase, not a local-only quirk). RLS policies
only take effect once the calling role already has the underlying SQL
`GRANT`; without it, every query fails with `42501 permission denied
for table X`, which looks like an RLS failure but isn't one. Added
migration `00000000000007_grants.sql` with explicit `GRANT`s that
mirror exactly what each table's RLS policies already allow — this is
not a widening of access, just making the schema reachable at all.
Discovered by testing the real signup → workspace-creation flow live
against local Postgres, not by inspection.

## 2026-09-27 — `workspaces` SELECT policy allows the owner directly

Postgres requires the row(s) produced by `INSERT ... RETURNING` to
also satisfy the table's SELECT RLS policies — not just the INSERT
`WITH CHECK`. The `create_workspace_with_owner` RPC inserts the
workspace and returns it (`returning * into new_workspace`) _before_
inserting the corresponding `workspace_members` owner row in the same
function, so at the moment of the RETURNING check,
`is_workspace_member(id)` was still false and the whole insert failed
with a generic "new row violates row-level security policy" error.
Fixed by widening the `workspaces` SELECT policy to `owner_id =
auth.uid() OR is_workspace_member(id)` (migration 1) — the owner
should always be able to see their own workspace regardless of the
membership row's existence, so this isn't a security loosening, just
closing a real temporal gap. Confirmed via a minimal `psql` repro
(`set role authenticated; set request.jwt.claims = '...'; insert ...
returning *;`) before and after the fix, and via a live browser
end-to-end test. Worth remembering for any future `insert ...
returning` RPC that runs before its own supporting rows exist.

## 2026-09-27 — Next.js version

Scaffolded with whatever `create-next-app@latest` resolved to (Next
16.3.6 at bootstrap time) rather than pinning to an older LTS. Reason:
spec says "modern Next.js App Router"; no requirement to pin. Risk:
less training-data familiarity with 16-specific API changes — mitigated
by checking `node_modules/next/dist/docs` for the exact installed
version instead of relying on memory, and preferring well-established
App Router patterns (server components, route handlers, server
actions) that have been stable across 14/15/16.

## 2026-09-27 — shadcn `<Form>` wrapper unavailable

The current shadcn CLI (Radix base, Nova preset) does not ship a
`form.tsx` registry item for the Radix base library. Forms are built
directly with `react-hook-form` + `@hookform/resolvers/zod`, using the
plain `Label`/`Input`/etc. primitives, instead of the classic shadcn
`<Form>`/`<FormField>` wrapper. No product behavior is affected; this
is purely a component-composition detail.

## 2026-09-27 — Package name

npm rejects capitalized/space-containing package names, and the
working directory is `Form Builder Saas claude`. The Next.js app is
scaffolded with `package.json` name `formcraft` (also used as the
working product name in docs/UI) while the directory itself is left
unchanged. No functional impact — the directory name is never read by
the app.

## 2026-10-05 — Lead capture asks one detail per screen

A `contact_info` question with several fields is shown to respondents
one field at a time (name, then email, then phone…), Typeform-style,
instead of all fields on one slide. It stays **one question** with one
answer record: the schema, leads, CRM sync, exports, logic and
recall are unchanged, and nothing needs migrating. Only the runtime
presents it in steps — each is checked as the respondent goes
(`validateContactField`), Back steps through the details before leaving
the question, the progress bar advances per detail, and the whole block
is still validated by `validateAnswer` on the last detail and again on
the server. The builder canvas still draws the fields together as a
preview. Not a per-form setting: asking one at a time is the single
behaviour, which keeps the settings panel small.

<!-- Add new decisions above this line, newest first. -->
