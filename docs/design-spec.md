# FormCraft — Design Spec (what to design)

This is the complete list of everything in FormCraft that needs a
design: every screen, every state, every button, every message. It
says **what** exists and how it behaves. It does **not** say how it
should look — colours, typography, spacing, shape, imagery and tone
are the designer's call.

How to read it:

- **Screens** are listed by the URL they live at.
- **States** list every situation the screen can be in (empty,
  loading, error, …). Each one needs a design.
- `Button label` in backticks is the current wording; the designer can
  change the wording, but the action must stay.
- Items marked **(not built)** are gaps found while writing this. They
  are optional: design them only if you want them built.

---

## 0. The product in one paragraph

FormCraft is a Typeform-style form builder. A **creator** signs up,
builds a form one question at a time, themes it, adds branching logic,
and publishes it to a public link. A **respondent** opens that link
(no account needed) and answers one question per screen; progress is
saved as they go, so they can leave and come back. Forms capture
**leads**: a Contact info step before the last question saves the
respondent's name, email and phone the moment they move past it, even
if they never submit. The creator sees all responses (completed and
incomplete) and every lead, exports them to CSV, and can send new
responses to webhooks or Google Sheets.

There are three very different design contexts:

1. **Marketing + auth**: public pages that sell the product and let
   people sign in.
2. **Creator app**: dashboard, builder, responses and integrations.
   Mostly used on desktop, but it must still work on a phone.
3. **Respondent form**: the published form. Mostly used on phones.
   It wears the **creator's** theme, not FormCraft's brand (see §2).

---

## 1. Foundations to define (FormCraft's own brand)

The founder chooses all of these. The list says what has to exist.

### Brand assets

- Logo / wordmark ("FormCraft"). It appears in the marketing header,
  the auth card header and the app header.
- App icon / favicon, plus the Apple touch icon.
- Social share image (Open Graph) for the marketing site.
- Default share image for published forms, used when a creator's form
  is shared in chat apps. The form's title and description are shown
  alongside it.

### Design tokens (define a value for each role)

- **Colour roles**: background, surface/card, muted surface, border,
  input border, primary (and the text colour on it), secondary,
  accent/hover, muted text, body text, destructive (and the text
  colour on it), success, warning, focus ring, overlay/scrim.
- **Status colours** used across the app:
  - Form state: Live · Draft · Unpublished (was live, taken down)
  - Unpublished changes (the dot in the builder header)
  - Response activity: Completed · In progress (active in the last 30
    minutes) · Abandoned (idle 30+ minutes)
  - Delivery statuses: succeeded / pending / failed / exhausted
- **Typography roles**: display (marketing hero), page title (H1),
  section title (H2), card title, body, small/secondary, caption/label
  (uppercase section labels are used today), monospace (URLs, secrets,
  IDs).
- **Spacing scale, corner radius scale, shadows/elevation, border
  widths.**
- **Icon set** (currently Lucide). Each of the 17 question types needs
  its own icon (see §5.4.2).
- **Motion**: transitions for question-to-question in the respondent
  form, dialog open/close, toasts, menus, and the progress bar.
- **Dark mode**: the code has dark-mode colour slots but no switch.
  Decide whether the creator app gets a dark mode.
- **Focus states**: every interactive element needs a visible
  keyboard focus style.

---

## 2. The respondent theme system (important constraint)

Published forms are styled by **each creator**, not by FormCraft's
brand. Design the respondent form as a **template driven by these
variables**, and check that it looks good across all of them:

| Setting           | Options                                                    |
| ----------------- | ---------------------------------------------------------- |
| Primary colour    | any hex (buttons, selected choices, progress bar, stars)   |
| Background colour | any hex                                                    |
| Text colour       | any hex (optional; otherwise derived from background)      |
| Font              | Inter, System, Georgia, Mono                               |
| Button style      | Rounded, Square, Pill                                      |
| Logo              | optional image (PNG/JPEG/WebP/SVG, max 5 MB)               |
| Background image  | optional image                                             |
| Presets           | Classic, Ocean, Forest, Sunset (one-click starting points) |

Designer deliverables for this:

- The **preset themes**: define the four (or a new set). Each preset
  sets primary, background and text colours, font and button style.
- How the logo and background image are placed (position, size,
  overlay or scrim so text stays readable over a photo).
- How selected, hover and focus states are derived from any primary
  colour.
- A **low-contrast warning**: the builder already checks contrast
  between text and background, and needs a design for the warning.

---

## 3. Shared component library (creator app)

Design every component in all its states: default, hover, focus,
active/pressed, disabled, loading (where noted), error (for inputs).

| Component                 | Variants / notes                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Button                    | primary, secondary, outline, ghost, destructive, link. Sizes: small, default, large, icon, small icon. **Loading state** (spinner + "Creating…", "Saving…"). |
| Text input                | with label, placeholder, helper text, error text; types: text, email, password, url, number, date                                                            |
| Textarea                  | also used as a borderless "inline editable" heading in the builder                                                                                           |
| Select / dropdown         | trigger + list                                                                                                                                               |
| Dropdown menu             | items with icons, separator, destructive item                                                                                                                |
| Switch                    | on/off (enable webhook, enable Sheets sync, required, allow "Other")                                                                                         |
| Checkbox, radio group     |                                                                                                                                                              |
| Tabs                      | Build · Share · Responses · Integrations (form header)                                                                                                       |
| Segmented control         | Completed · Incomplete, with counts                                                                                                                          |
| Sidebar nav               | Forms · Leads · Templates, active state; mobile drawer                                                                                                       |
| Account menu              | initials avatar, name, email → Log out                                                                                                                       |
| Badge                     | Live, Draft, Unpublished, Completed, In progress, Abandoned, delivery statuses, "(default)"                                                                  |
| Drop-off bar row          | question number, label, proportional bar (worst step highlighted), "N · %"                                                                                   |
| Status dot + tooltip      | builder: "Live" vs "Unpublished changes"                                                                                                                     |
| Card                      | form card, template card, stat card, answer card, endpoint card                                                                                              |
| Table                     | responses table: clickable rows, action column                                                                                                               |
| Pagination                | Previous / Next with a page indicator; disabled states                                                                                                       |
| Alert (inline banner)     | info, success, destructive                                                                                                                                   |
| Confirmation dialog       | title, explanation, Cancel, destructive confirm                                                                                                              |
| Modal dialog              | preview dialog (large)                                                                                                                                       |
| Tooltip                   | icon-button labels, status explanations                                                                                                                      |
| Toast                     | success, error, neutral; optionally with an action button ("View live")                                                                                      |
| Skeleton loaders          | dashboard grid, builder layout                                                                                                                               |
| Spinner                   | inline and full page                                                                                                                                         |
| Progress bar              | respondent form (themed)                                                                                                                                     |
| Empty state block         | icon, title, text, 1–2 actions                                                                                                                               |
| Colour picker field       | swatch + hex input                                                                                                                                           |
| Image upload field        | empty, uploading, uploaded (thumbnail + remove), error                                                                                                       |
| Copy-to-clipboard control | with "Copied" feedback                                                                                                                                       |
| Timestamp                 | relative ("5m ago") and absolute date-time; full value on hover                                                                                              |

---

## 4. Marketing and auth

### 4.1 Landing page — `/`

- **Header** (sticky): logo, `Features` and `How it works` anchor
  links, `Log in`, `Get started free`. Signed in: a single `Go to
dashboard` button.
- **Hero**: badge "Lead capture built in"; headline "Forms people
  finish. Leads you never lose."; sub-headline; CTAs `Start building
for free` (signed in: `Go to dashboard`) and `Browse templates`;
  trust line "Free to start · No credit card".
- **Product illustration**: a form screen (contact step) beside a
  Leads list showing "Completed" and "Abandoned" leads. Currently
  drawn with HTML; replace with real product art if wanted.
- **Features** (6 cards): one question at a time · lead capture that
  sticks · see who didn't finish · logic & branching · on-brand design
  · send data anywhere.
- **How it works**: 3 numbered steps (Build · Share · Follow up).
- **Closing CTA band** and **footer** (logo, copyright).
- Responsive: phone, tablet, desktop.

### 4.2 Auth layout (shared)

Split screen on desktop: left half has the logo and the form card;
right half is a brand panel with the headline and three benefit
bullets. On phones only the left half shows. Every auth screen below
sits inside it.

### 4.3 Log in — `/login`

- Title "Log in", subtitle "Welcome back."
- Fields: Email, Password. A `Forgot password?` link sits beside the
  password label.
- Button: `Log in` → loading "Logging in…".
- Link: "Don't have an account? `Sign up`".
- **States**:
  - field errors (under each field)
  - form error (wrong email/password)
  - rate-limited message
  - **notice banner** from an email link, two variants:
    - "We couldn't sign you in from that link — if you just confirmed
      your email, log in below."
    - "That password reset link has expired or was already used…"
- Visitors sent here from a protected page return to that page after
  logging in. This is invisible, so it needs no design.

### 4.4 Sign up — `/signup`

- Title "Create your account", subtitle "Start building forms in
  minutes."
- Fields: Full name, Email, Password (helper text: "At least 8
  characters.").
- Button: `Create account` → "Creating account…".
- Link: "Already have an account? `Log in`".
- **States**: field errors, form error (e.g. email already
  registered), rate-limited. Entered values are kept after an error.

### 4.5 Check your email (after sign-up) — `/signup/check-email`

- Confirmation message that a verification email was sent. Consider a
  "back to log in" link.

### 4.6 Forgot password — `/forgot-password`

- Title "Reset your password", explanation text.
- Field: Email. Button: `Send reset link` → "Sending…".
- A back-to-login link is recommended.

### 4.7 Check your email (after reset request) — `/forgot-password/check-email`

- "If an account exists for that address, we've sent a link…"
  (the wording deliberately doesn't reveal whether the account
  exists).

### 4.8 Set new password — `/reset-password`

- Title "Choose a new password", hint "Make it at least 8
  characters."
- Fields: New password, Confirm password. Button: `Save new password`.
- **States**:
  - checking the link (loading)
  - **Link expired or invalid**: its own screen, which says "Request a
    new password reset link and try again". Today it has no button;
    add a `Request new link` action.
  - field errors (too short, passwords don't match)
  - server error
  - success (goes to the dashboard)

---

## 5. Creator app

### 5.1 App shell (workspace pages: Forms, Leads, Templates)

- **Left sidebar** (desktop, fixed):
  - logo + workspace name
  - primary `New form` button (loading "Creating…")
  - nav: `Forms`, `Leads`, `Templates`, each with an icon and an active
    state (Forms stays active on every page inside a form)
  - bottom: **account button** (initials avatar, name, email) →
    menu with "Signed in as …", `Account settings`, `Log out`
- **Phones**: a top bar with a menu button and the logo; the sidebar
  opens as a slide-over drawer with a scrim and close button. It is a
  real modal dialog (titled "Menu"): Escape closes it, Tab stays inside
  it, and focus returns to the menu button.
- Content area: light canvas background, white cards, max width ~1150px.
- **Page header** pattern on every workspace page: title, one-line
  description, actions on the right.
- **Loading skeleton** for page transitions.
- **(not built)**: workspace settings, workspace switcher (see §10).

### 5.2 Forms dashboard — `/dashboard`

- **Page header**: "Forms", "Build, share, and follow up on every
  response.", actions `Templates` and `New form`.
- **Get started checklist** (until all done): progress bar "N of 4
  done" and four linked steps — Create a form · Publish it · Get your
  first response · Capture your first lead. Done steps are checked.
- **Stat cards** (4): Live forms (of N total) · Completed responses ·
  Incomplete ("answered some, didn't submit") · Leads (links to Leads).
- **Forms list** (one card, a row per form): letter tile, title, Live /
  Draft / Unpublished badge, "Edited 5m ago", counts "N completed" and
  "N incomplete" (each links to that view), **⋯ menu**: `Edit`,
  `Preview`, `Rename`, `Share`, `Responses`, `Copy link` (live only),
  `Publish` / `Unpublish`, `Duplicate`, `Delete`. Whole row opens the
  builder. On phones the counts move under the title.
- **Rename dialog**: name field, `Cancel` / `Save` ("Saving…").
- **Delete confirmation dialog**: "Delete {title}?" — the form leaves
  the dashboard and, if live, its link stops working. `Cancel` /
  `Delete form`.
- **First-run state** (no forms): "Welcome to FormCraft" with a
  3-step explainer (Build · Publish & share · Collect leads & responses)
  and `Start from scratch` / `Browse templates`.
- **Toasts**: link copied, duplicated, deleted, and errors.
- **(not built)**: search, sort, filter, folders.

### 5.2b Leads — `/leads`

- **Page header**: "Leads", "Everyone who left their contact details in
  one of your forms — including people who didn't finish.", action
  `Export CSV`.
- **Toolbar**: search field ("Search name, email, phone…") and form
  filter (All forms / each form).
- **Table**: Name (row opens that response) · Contact (email as mailto,
  phone as tel) · Company · Form · Status (**Completed** / **In
  progress** / **Abandoned**) · Source (campaign, referring site or
  "Direct") · Captured (relative time). Pagination.
- **Empty states**: no leads yet (explains a Contact info step placed
  before the last question, with `Add lead capture to a form`); no
  leads from this form; no search matches ("No leads match “…”").

### 5.2c Account settings — `/settings`

Reached from the account menu. Page header "Account settings".

- **Profile** card: Full name + `Save`.
- **Email** card: email + `Change email`; note that a confirmation link
  goes to the new address and nothing changes until it's clicked.
- **Password** card: New password, Confirm password, `Update` (at
  least 8 characters; mismatch error).
- **Delete account** card (danger styling): explains everything is
  permanently deleted; `Delete my account` opens a dialog requiring the
  user to type their email before `Delete account` enables
  ("Deleting…").
- After deletion the user lands on the landing page with a banner
  "Your account and all its data have been deleted."
- Toasts for every save and error.

### 5.3 Templates gallery — `/templates`

- Page header "Templates" with description.
- `Start from scratch` button (loading state).
- Templates grouped by **category** (a section heading per category).
- **Template card**: title, description, `Use this template` (loading:
  "Creating form…"). Consider adding a visual preview of each
  template.
- Empty state if there are no templates.
- Also reachable signed-out from the landing page, which sends
  visitors through log-in.

### 5.4 Form builder — `/forms/{id}`

The most complex screen. Desktop layout has three columns under a
header: **left sidebar** (structure) · **canvas** (the selected item,
editable in place) · **right panel** (settings for the selected item).

#### 5.4.1 Form header (shared by every page inside a form)

Build, Share, Responses, Integrations and Settings all use the same
header.

- Left: back arrow ("All forms"), form title, and on non-builder pages
  a **Live / Draft / Unpublished** badge. In the builder the title is **editable
  inline** (click, Enter/blur saves, Esc cancels) and is followed by the
  **save status**, with five states:
  - "Saving…", "Saved", "Couldn't save — retrying"
  - **"Not saved"** (invalid setting; clicking jumps to it; tooltip)
  - "Edited elsewhere — reload to continue" + `Reload`
- Centre: tabs **Build · Share · Responses · Integrations · Settings**
  (icons + labels, active state). On narrow screens they move to a second,
  scrollable row.
- Right, in the builder:
  - status dot when live (green "Live"; amber "Live — your latest edits
    aren't published yet"), `Copy link`, `Open live form`
  - `Preview`
  - **Publish button**: `Publish` · `Publish changes` · disabled
    `Up to date` · loading "Publishing…"
  - **⋯ menu**: `Share options`, `Republish`, `Unpublish`
- Right, on other form pages: `Publish` when draft; otherwise
  `Copy link` + `Open live form`.
- Leaving the builder with unsaved edits: closing or reloading the tab
  shows the browser's "Leave site?" prompt (browser-native, not
  designable); moving to another page saves on the way out.
- **First publish** opens a "🎉 Your form is live" dialog: the link,
  `Open`, `Copy link`, `More ways to share`. Later publishes show a
  toast "Changes published".

#### 5.4.2 Left sidebar

- **Questions** section:
  - numbered list rows: number, type icon, label (truncated), selected
    state
  - row actions (appear on hover/focus): `Move up`, `Move down`,
    `Duplicate`, `Delete`
  - the **welcome screen** is always first: only `Delete`, no
    move/duplicate
  - the last remaining question can't be deleted (no delete button)
  - disabled states for move-up on the first movable row and
    move-down on the last
- `Add question` button → **menu of question types**. Each type needs
  an icon and a name:
  - Welcome screen (only when the form has none)
  - Short text · Long text · Email · Phone · Website URL ·
    **Contact info (lead)** · Number
  - Multiple choice · Checkboxes · Dropdown · Yes / No
  - Date · Rating · Opinion scale · File upload · Statement

  Consider grouping them into "Screens" vs "Questions" and adding a
  short description per type.

- **Capture leads card** (only when the form has no Contact info
  step): short explanation + `Add lead capture`, which inserts the step
  before the last question and selects it.
- **Endings** section:
  - list rows: title, "(default)" tag for the default one, selected
    state, delete (x) on hover (not on the only ending)
  - `+` Add ending
- **Design** (theme) and **Logic** entries (navigation rows that
  switch the canvas).
- **(not built)**: drag-and-drop reordering (see §10).

#### 5.4.3 Canvas — question selected

The canvas is **WYSIWYG**: each screen is drawn as a card ("slide") in
the form's own theme (background, text colour, font, logo, button
style), so the creator edits exactly what respondents see.

- Above the card: type icon + name, "· Required" when required.
- Inside the card: **question text** and **description**, editable in
  place (placeholders "Type your question here", "Add a description
  (optional)"); a preview of the answer control (§6.3); an `OK` button
  in the form's button style. Welcome/statement screens are centred and
  show their own button label.
- Below: hint "Click the text above to edit it…".

#### 5.4.4 Canvas — ending selected

- Label "Default ending — shown after the form is submitted"; themed
  card with editable title ("Thank you!") and message, plus the button
  when a label or redirect is set.

#### 5.4.5 Canvas — design selected

- Themed card showing the form title, "This is how your form looks to
  respondents." and a `Start` button — updates live as settings change.

#### 5.4.6 Canvas — logic selected (full width, no right panel)

- Title "Logic" and an explanation (rules run top to bottom, the
  first match wins, otherwise the form continues in order).
- Empty state: "No logic yet. Add a rule…".
- **Rule card**:
  - number
  - row 1: "If" [question ▾] [operator ▾] [value control] 🗑
  - row 2: "Then →" [Go to question / Go to ending ▾] [target ▾]
- **Jumps only go forward**: the question target list offers only
  questions after the rule's own question (a back-jump could loop
  forever), and "Jump to question" is disabled on the last question. A
  rule saved before this limit keeps its old target shown as "(earlier —
  pick a later one)", and the save bar explains it ("Logic rule 2: jumps
  back to an earlier question…") until it's changed.
- Operators: is · is not · contains · is greater than · is less than ·
  is answered · is not answered. Which ones appear depends on the
  question type: contact blocks and file uploads only offer the two
  "answered" checks; multi-select offers "contains" (not "is").
- Deleting an option removes the rules that checked it, with a toast
  ("1 logic rule removed — they checked an option you just deleted").
  Moving a question is refused (toast) if it would turn a jump into a
  jump back.
- The value control changes with the question: an option picker for
  choice questions, a number field, a text field, yes/no, or none for
  "is answered".
- `Add rule` button, disabled when the form has no answerable
  questions.
- **(not built, nice to have)**: a visual flow map of branches.

#### 5.4.7 Right settings panel — per selection

At the top of the panel (every type except the welcome screen): a
**Question type** select (icon + name per type). Changing to a type
that can't keep the current settings or logic opens a confirmation
dialog (see §5.4.8).

Every question type has **Required** (switch), except the welcome
screen, statement and contact info (which sets required per field).
Then the type-specific fields:

| Type            | Settings fields                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Welcome screen  | Image (optional upload) + image description (alt text, shown once an image is set), Button label                                     |
| Statement       | Image + alt text (as above), Button label                                                                                            |
| Short text      | Placeholder, Min length, Max length                                                                                                  |
| Long text       | Placeholder, Max length                                                                                                              |
| Email           | (none; the note "Answers are validated automatically as an email address")                                                           |
| Website URL     | (none; similar note)                                                                                                                 |
| Phone           | Default country code                                                                                                                 |
| Contact info    | "Lead details to collect": Name / Email / Phone / Company, each with a checkbox (shown) and a Required switch; at least one stays on |
| Number          | Min, Max, Decimal places (Any / Whole numbers only / Up to 1, 2, 3)                                                                  |
| Multiple choice | Options editor, Allow "Other" (switch)                                                                                               |
| Checkboxes      | Options editor, Allow "Other", Min selections, Max selections                                                                        |
| Dropdown        | Options editor                                                                                                                       |
| Yes / No        | Yes label, No label                                                                                                                  |
| Date            | Earliest date, Latest date                                                                                                           |
| Rating          | Scale (1–5 or 1–10)                                                                                                                  |
| Opinion scale   | Min, Max, Left label, Right label                                                                                                    |
| File upload     | Accepted file types, Max size (MB)                                                                                                   |

- **Options editor**: list of option rows (editable text, delete),
  `Add option`, reorder (decide how).
- **Ending settings**: Button label, Redirect URL (optional).
- **Theme settings**:
  - preset tiles (Classic, Ocean, Forest, Sunset; selected state)
  - Primary / Background / Text colour pickers
  - low-contrast warning
  - Font select
  - Button style select
  - Logo upload
  - Background image upload
- **"Not saved" alert** at the top of the panel when the selected item
  has an invalid setting, e.g. "Min can't be greater than max".

#### 5.4.8 Builder dialogs

- **Delete question** when logic rules use it: "{label} is used by N
  logic rule(s)… deleting it also removes those rules",
  `Cancel` / `Delete`.
- **Delete ending**: same pattern, with the logic rules that jump to
  it.
- **Change question type**: "Change to {type}?" — says the settings
  will reset and/or N logic rules will be removed, and that collected
  responses keep their answers. `Cancel` / `Change type`.
- **Preview dialog**: large modal running the real form with the
  current draft.
  - Toggle: `Desktop preview` / `Mobile preview` (phone-frame size).
  - Close button.
  - Error state: "Unable to preview this form." (shown when the draft
    is invalid).
  - Should make clear that preview answers aren't saved.

#### 5.4.9 Builder states

- Loading skeleton (header + three columns).
- Opened from the dashboard's "Preview" (`?preview=1`): the builder
  loads with the preview dialog already open.
- Form not found (goes to 404).
- **Small screens**: the three panes stack vertically (structure,
  canvas, settings) and the page scrolls. A better phone layout (e.g.
  panels as drawers) is open for design.

### 5.5 Share — `/forms/{id}/share`

- Title "Share your form", "Anyone with the link can respond — no
  account needed."
- **Draft**: a centred card "Publish to get your link" + `Publish` and
  `Keep editing`.
- **Live**:
  - amber notice when there are unpublished edits, with `Publish
changes`
  - **Link** card: the URL in a read-only field, `Copy link`, `Open`,
    and share buttons (Email, WhatsApp, LinkedIn, X)
  - **Embed** card: snippet + `Copy embed code`; copy explains the
    embed resizes to fit each question and embedded visits are tracked
    separately
- **Lead capture** card — says what respondents actually get (the
  live version, and whether unfinished responses are saved), one of:
  - **on** ("…saved the moment a respondent passes that step…" +
    `View leads`);
  - **limited** (live form has the step but "Save unfinished responses"
    is off, so only people who submit are captured) + `Open settings`;
  - **set up, but not live yet** (the contact step is only in the draft)
    - `Open in builder`;
  - **off** + `Add lead capture`.
- The embed snippet's script only resizes the iframe it belongs to, for
  its own form, within 200–20,000 px.
- **(not built)**: QR code.

### 5.5b Responses — `/forms/{id}/responses`

- **Period switch** (segmented): `7 days` · `30 days` · `90 days` ·
  `All time`, with a "Performance · last 30 days" label.
- **Stat cards** (4) for that period: Views · Started · Completed ·
  Completion rate.
- **View switch** (segmented): `Completed (N)` · `Incomplete (N)`, plus
  `Export CSV` for the current view.
- Incomplete view explanation: people who answered at least one
  question but didn't submit; answers (and contact details) are saved
  as they go; what **In progress** and **Abandoned** mean.
- **"Where people drop off"** card (Incomplete view, when there are
  abandoned responses): one row per question in form order — number,
  question, a bar, and "N · %" of abandoned respondents who stopped
  there; the worst step is highlighted.
- **Table**:
  - Completed: Submitted · Contact (when the form has lead capture) ·
    up to 2 more answer columns · Ending · Source · delete
  - Incomplete: Last active · Contact · answers · **Progress** (bar +
    "2/5") · **Stopped at** · **Status** (In progress / Abandoned) ·
    Source · delete
  - Source hides on narrower screens; whole row opens the response;
    long answers truncate
- **Pagination**.
- **Empty states**: not published (+ `Publish`); published, none yet
  (+ `Copy form link`, `More ways to share`); no incomplete responses.
- **Delete response dialog** and toasts as before.
- **(not built)**: response search, per-question charts.

### 5.6 Response detail — `/forms/{id}/responses/{responseId}`

- Top row: back link ("Completed responses" / "Incomplete
  responses"), `Newer` / `Older` arrows within that view, delete.
- **Summary card**: activity pill (Completed / In progress /
  Abandoned) with "Reached ending …" or "Answered 2 of 5 questions —
  stopped at …"; then four facts: **Started**, **Submitted** or **Last
  active**, **Time spent**, **Source**.
- **Lead card** (when contact details exist): name, email (mailto),
  phone (tel), company.
- **Answers list**: numbered rows, question label + answer; line
  breaks kept; files as a download link; "Skipped" / "Not answered
  yet" when empty.
- Footer: referrer and each UTM value present (source, medium,
  campaign, term, content).

### 5.7 Integrations — `/forms/{id}/integrations`

Form header with Integrations active; page title "Integrations" and
intro ("responses are always kept here too"). Two sections, each with
an icon tile, title and description.

#### Webhooks

- Section intro: "Send every completed response to your own server as
  a signed JSON request."
- **Add endpoint** card:
  - URL field (placeholder `https://example.com/webhook`); Enter
    submits
  - `Add` button (disabled when empty; loading)
  - errors as toast: invalid URL, must use HTTPS, private address not
    allowed
- **Signing secret banner** (shown once, right after adding):
  explanation "Save this now — it won't be shown again", the secret in
  monospace, and a copy button.
- **Empty state**: "No webhooks configured…".
- **Endpoint card**:
  - URL (monospace, truncated)
  - Enabled switch
  - `Test` button (toasts: "Test delivery succeeded" / "Test delivery
    failed: {reason}")
  - delete (🗑)
  - **Delivery log**: last 5 rows, each with a time, "attempt N" when
    retried, and a status badge (succeeded / pending / failed /
    exhausted). Empty: "No deliveries yet."
- **Delete webhook dialog**: "Delete this webhook?", explains that
  deliveries stop and the secret can't be recovered;
  `Cancel` / `Delete webhook`.

#### Google Sheets

- Section intro: "Add a row to a spreadsheet each time someone
  completes this form."
- **Not configured on this server**: an alert explaining that the
  administrator must set up Google credentials.
- **Not connected**: short explanation + `Connect Google Sheets`
  button (goes to Google's consent screen).
- **Return-from-Google banners**:
  - success: "Google Sheets connected."
  - declined: "…access was declined."
  - failed: "…couldn't be connected. Please try again."
- **Connected** card:
  - "Connected" title, Enabled switch, `Disconnect` button (asks first:
    "Disconnect Google Sheets? New responses will stop being added…
    Rows already there stay put." · `Keep connected` / `Disconnect`)
  - Spreadsheet ID field (hint: "from the sheet's URL, between /d/ and
    /edit") + save button
  - **Sync log**: time, attempts, status badge. Empty: "No syncs yet."
- Toasts: spreadsheet connected, disconnected, failed to disconnect,
  failed to save.

### 5.8 Form settings — `/forms/{id}/settings`

Form header with Settings active; title "Form settings". Three cards
(icon tile, title, description):

- **Unfinished responses**:
  - switch "Save answers as people go" with a description that changes
    with its state (on: incomplete responses and leads are kept and
    respondents are told; off: nothing stored until submit, for
    sensitive forms)
  - select "Automatically delete unfinished responses": Keep until I
    delete them · after 30 / 90 / 180 days · after 1 year; note that
    it's counted from last activity and completed responses are never
    auto-deleted
- **Notifications**: switch "Email me about new responses" with the
  recipient's address and a note that answers aren't included; a
  warning line when email isn't configured on the server.
- **Public link**: prefix (`yourdomain/f/`) + editable slug field +
  `Save link` (disabled until changed); note that the old link and
  existing embeds stop working. Validation error for bad or taken
  slugs.
- Toasts: "Saved", "Notifications on/off", "Link updated".

---

## 6. Respondent form — `/f/{slug}`

Uses the **creator's theme** (§2). Mobile-first. One question per
screen.

**Embedded** (inside another site via the Share page's embed code):
the same screens without full-viewport height — the frame grows and
shrinks to fit each question, so design for content-height layouts too.

### 6.1 Page-level states

- **Loading**: themed background + spinner.
- **Couldn't load** (network): message + `Try again`.
- **Form unavailable** (unpublished, deleted or wrong link): neutral,
  **FormCraft-branded** page: "This form isn't available", with an
  explanation. This page must not use any creator's theme.
- **Resumed**: a returning respondent lands back on the question they
  left. Consider a subtle "Welcome back" cue.
- Browser tab title = form title. The link preview shows the form
  title and description.

### 6.2 Step layout (every question screen)

- Logo (if set), background image (if set).
- Question number (optional; decide).
- **Question label**, with a required marker (currently an asterisk).
- Description (optional).
- **Answer control** (see §6.3).
- **Selection hint** where relevant ("Choose as many as you like",
  "Choose 2–3").
- **Inline error** (see §6.5).
- **Action row**:
  - `Back` (arrow; hidden on the first question)
  - primary button: `OK` / the question's button label, `Submit` on
    the last question, "Submitting…" with a spinner
  - keyboard hint "press Enter ↵" (long text: "Shift ⇧ + Enter ↵ for
    a new line"); hidden on touch devices
- **Saving notice** (only when the form saves as people go): a small
  line above the progress bar — "Your answers are saved as you go.";
  on the contact step: "Your details are saved when you continue, even
  if you don't finish."
- **Progress bar** (themed), showing how far through the form the
  respondent is.
- **Transitions** between questions (forward and back).
- **Auto-advance**: Multiple choice, Yes/No, Rating, Opinion scale and
  Dropdown move on automatically about 0.35s after a choice (never on
  the last question). Design a "selected" confirmation beat.

### 6.3 Answer controls — all 17 types (default, hover, focus, selected, error, disabled)

1. **Welcome screen**: optional image (with alt text), title,
   description, start button (default "Start"), no input.
2. **Statement**: optional image, text + continue button (default
   "Continue").
3. **Short text**: single-line input, placeholder.
4. **Long text**: multi-line, grows as you type.
5. **Email**: input, placeholder `name@example.com`.
6. **Phone**: input, placeholder `+1 555 000 0000`.
7. **Website URL**: input, placeholder `https://example.com`.
   7b. **Contact info (lead capture)**: stacked labelled inputs for the
   chosen fields (Name, Email, Phone, Company), "*" or "(optional)"
   per field. Enter moves to the next field; Enter on the last one
   continues. Errors name the field ("Enter your email.").
8. **Number**: numeric input; respects min/max/decimals.
9. **Multiple choice**: list of option tiles (radio); optional
   **Other** tile that reveals a text field when chosen.
10. **Checkboxes**: option tiles (multi); optional **Other** with a
    text field; min/max hint.
11. **Dropdown**: select with "Choose an option" placeholder; long
    lists.
12. **Yes / No**: two large tiles (custom labels allowed).
13. **Date**: date picker; earliest/latest limits.
14. **Rating**: 5 or 10 stars; hover preview; selected fill.
15. **Opinion scale**: row of numbered cells from min to max (e.g.
    0–10) with optional left/right end labels. Must fit on a phone
    (11 cells).
16. **File upload**:
    - picker/drop zone showing the accepted types ("Images", "PDF
      files", …) and the max size
    - states: uploading (progress), uploaded (file name + replace or
      remove), error (too large, wrong type, upload failed)

### 6.4 Ending screen

- Ending title, description.
- Optional button (label default "Done"). If the creator set a
  redirect URL, the button takes the respondent there.
- Consider a "Made with FormCraft" link (not built).

### 6.5 Validation messages (shown inline, per question)

- This question requires an answer.
- Enter a text answer. · Enter at least N characters. · Enter at most
  N characters.
- Enter a valid email address. · Enter a valid phone number. · Enter
  a valid URL, like example.com.
- Enter a number. · Enter a whole number. · Use at most N decimal
  places. · Enter a number between A and B / of at least A / of at
  most B.
- Choose one of the options. · Choose one or more options. · Choose
  from the listed options. · Each option can only be chosen once. ·
  (min/max selection variants)
- Choose yes or no. · Choose a rating. · Choose a value on the scale.
- Enter a valid date. · Choose a date on or after X / on or before Y.
- Upload a file.
- Contact info: Enter your name / email / phone / company. · That … is
  too long.
- **Submission errors**: server rejected an answer (the form jumps
  back to that question and shows the error); too many attempts (rate
  limited); network failure (retry).

### 6.6 Keyboard and accessibility behaviour

- Enter = next/submit; Shift+Enter = new line in long text.
- Full keyboard navigation of the choice tiles and stars.
- **Focus follows the question.** When a new question or the ending
  appears, focus goes to its heading unless a text box already took it
  (Tab then moves into the options). Without this, focus is left on the
  page body and nothing is announced. The heading is focusable but not
  in the Tab order and shows no ring.
- Screen-reader labels (required fields announced, errors announced —
  including a failed file upload).
- Hint text ("press Enter", "Your answers are saved as you go") sits at
  70% opacity so it stays above AA contrast on a white theme; the app's
  muted text and destructive colours were darkened for the same reason
  (checked automatically by `accessibility.spec.ts`). The designer should
  keep the focus order and contrast workable for any creator theme.

---

## 7. System pages (FormCraft brand)

- **404** "Page not found" + `Go to your forms`.
- **Something went wrong** (error boundary) + `Try again` + `Go to your
forms`. Copy reassures that work is saved.
- **Critical error** (whole app failed) + reload.
- **Loading skeletons**: dashboard lists, builder.

---

## 8. Emails

1. **New response notification** (to the form owner): subject "New
   response: {form title}"; heading "New response received"; form
   title + time (UTC); `View response` button → dashboard. HTML and
   plain-text versions. It deliberately contains no answers.
2. **Confirm your email** (signup), sent by Supabase Auth. The
   template is edited in Supabase.
3. **Reset your password**, sent by Supabase Auth. The template is
   edited in Supabase.

Design one shared email layout (logo header, body, button, footer)
for all three.

---

## 9. Cross-cutting checklist

- **Responsive breakpoints**: phone (~375), tablet (~768), laptop
  (~1280), wide (~1536+). The respondent form is phone-first; the
  creator app is desktop-first but must be usable on a phone (except
  the builder, see §5.4.9).
- **Every async action** needs a pending state and a success and
  failure message: create, duplicate, delete, rename, publish,
  unpublish, save, upload, export, test webhook, connect Sheets, each
  settings change, account changes.
- **Every destructive action** needs a confirmation dialog: delete
  form, delete response, delete question (when logic uses it), delete
  ending (when logic uses it), lossy question-type change, delete
  webhook, delete account, disconnect Sheets.
- **Empty states**: no forms, no templates, no responses (unpublished
  vs published), no logic rules, no webhooks, no deliveries, no
  syncs.
- **Timestamps**: relative on cards, absolute elsewhere, in the
  viewer's timezone.
- **Truncation rules**: long form titles, long question labels in
  sidebar/table/select menus, long URLs.
- **Copy voice**: define tone for buttons, errors and empty states.
  Every current string is listed above for reference.

---

## 10. Known gaps worth deciding on (not built)

These came up while mapping the app. They are **not** in the current
product; design them only if the founder wants them built.

1. **Drag-and-drop reordering** of questions and options (today: up /
   down buttons).
2. **Workspace**: rename, invite members, roles, switch workspace.
3. **Response search and per-question charts** (Leads already has
   search).
4. **QR code** on the Share page.
5. **Visual logic map**.
6. **Phone-optimised builder** (drawers instead of stacked panes).
7. **Lead follow-up**: notes/status per lead, CRM sync, an alert when a
   lead abandons the form.
8. **Pricing / billing**: not in Phase 1.

---

## 11. Deliverables checklist for the designer

- [ ] Brand assets (§1)
- [ ] Tokens: colour roles, type, spacing, radius, elevation, motion
      (§1)
- [ ] Respondent theme template + 4 presets + contrast warning (§2)
- [ ] Component library with all states (§3)
- [ ] Landing page, 3 breakpoints (§4.1)
- [ ] 6 auth screens + notices and error states (§4.2–4.8)
- [ ] App shell (sidebar + mobile drawer), dashboard (checklist,
      stats, list, menu, rename dialog, first-run), Leads (search,
      filters, statuses), account settings, templates (§5.1–5.3)
- [ ] Form header (shared, 5 tabs), builder: sidebar + lead card,
      themed canvas modes, settings for 17 types incl. type switcher and
      screen images, theme panel, logic editor, dialogs incl. "your form
      is live" and type change, preview (§5.4)
- [ ] Share page (§5.5)
- [ ] Responses (period switch, Completed / Incomplete, drop-off,
      statuses, source) + detail with timing and lead card (§5.5b–5.6)
- [ ] Form settings (§5.8)
- [ ] Integrations: webhooks + Google Sheets, all states (§5.7)
- [ ] Respondent form: page states, step layout, saving notice,
      embedded layout, 17 controls, ending,
      errors, on phone and desktop (§6)
- [ ] System pages (§7)
- [ ] Email layout + 3 emails (§8)
- [ ] Decisions on §10 gaps
