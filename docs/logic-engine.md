# Logic engine

How FormCraft decides what a respondent sees next, what is required,
and what gets computed. Read this before changing anything in
`src/domains/logic` or the logic parts of the form schema.

## 1. Audit (2026-10-02, before the engine work)

**Architecture.** A form is one canonical JSON document
(`FormSchemaV1`, Zod, `src/domains/forms/schema/v1.ts`) stored in
`form_versions.schema` (JSONB). Drafts are mutable; publishing copies
the draft into an immutable `published` version. Responses point at
the exact `form_version_id` they were served from; answers are rows in
`answers (response_id, question_id, value jsonb)`. Parse →
`validateSemantics` → `compileFormSchema` (cycle + reachability checks)
runs on save, publish, preview, the public page and submission.

**One evaluator, three callers.** `evaluateNextStep` / `walkForm`
(`src/domains/logic`) are used by the builder Preview, the public
runtime (client) and `completeResponse` (server, authoritative — it
decides the ending and which questions were on the path, so a hidden or
skipped required question is never enforced).

**What logic could do.** `logic: LogicRuleV1[]` — one rule = one
operator (`equals`, `not_equals`, `contains`, `gt`, `lt`,
`is_answered`, `is_not_answered`) against the answer of the question it
sits on, and one action (`jump_to_question` forward only, or
`jump_to_ending`). Rules run in array order; the first match wins; no
match = next question in order, then the default ending.

**Existing safety nets to keep.** Forward-only jumps (builder +
`validateSemantics`), inescapable-loop and unreachable-question checks
at compile, a runtime "never revisit" guard for legacy forms, dangling
option/question/ending references rejected, rules waiting for a value
blocked at publish, server-side per-question validation on the path.

**Limitations.** No variables, calculations, compound or cross-field
conditions, visibility, conditional validation, scoring, outcomes,
recall/dynamic text, hidden fields, simulator or decision trace.

**Migration risks.** (1) Every stored form — drafts and immutable
published versions — must keep parsing and behaving identically.
(2) The client runtime and the server walk must never disagree.
(3) Zod strips unknown keys, so new fields must be added to the schema
before any code writes them. (4) Anything time-dependent makes a replay
non-deterministic unless the clock is pinned.

## 2. Design

Everything is additive to `FormSchemaV1` (still `schemaVersion: 1`), so
no stored form needs rewriting and published versions stay immutable.

### Primitives

- **Expression** (`Expr`) — a small typed AST, never code:
  literals, `answer(questionId[, field])`, `variable(id)`,
  `hidden(name)`, binary `+ - * / %`, and whitelisted functions
  (`SUM AVG MIN MAX COUNT ROUND CEIL FLOOR ABS PERCENTAGE LENGTH TODAY
DAYS_BETWEEN AGE`). Evaluation is total: bad types, division by zero
  and NaN produce `null`, never an exception or `NaN`.
- **Condition** — `all` / `any` / `not` over `compare(left, op, right)`
  where both sides are expressions, so cross-field comparisons
  (`end_date >= start_date`, `confirm_email == email`) need nothing
  special.
- **Variable** — `{ id, name, type, initial }`, types number / string /
  boolean / date / list. Variables only change through actions, in a
  fixed order, so there are no formula dependency cycles to detect.
- **Rule** — `on` (event) + optional `when` (condition) + `then`
  (actions). Events today: `form_started`, `question_answered(q)`,
  `form_completed`. Actions today: `jump_to_question`,
  `jump_to_ending`, `set_variable` (set / add / subtract / multiply /
  divide / append / remove), `go_to_highest` (outcome quizzes).
- **Question extras** — `visibleIf` (show only when…), `validations`
  (conditional / cross-field checks with a message). **Option extras**
  — `scores` (points into variables, the quiz/scoring shortcut).

Legacy `logic` rules are translated into the same rule model at
evaluation time, so there is exactly one engine.

### Evaluation order (deterministic, documented, tested)

1. Start: variables take their `initial` values; hidden fields are read;
   `form_started` rules run (variable actions only).
2. Leaving a visible question: (a) option scores for its answer are
   applied, (b) its rules run in order — legacy `logic` first, then
   `rules`. Every matching rule's variable actions run; the **first**
   matching rule that has a navigation action decides where to go.
3. No navigation decided → the next question in order that hasn't been
   shown and is visible. A question whose `visibleIf` is false is
   skipped (it is not on the path, so it is never required or stored).
4. No next question → `form_completed` rules run the same way (variable
   actions, then first navigation action picks the ending); an ending
   chosen earlier by a question rule stands. Otherwise the default
   ending.
5. Variables are never stored as truth: they are recomputed by
   replaying the answers along the path, on the client while answering,
   and on the server at submission (authoritative). "Today" is pinned to
   the evaluation time (submission time on the server) in the form's
   timezone (UTC unless set).

Every step appends to a **decision trace** (rule matched / skipped,
variable changed, question hidden, ending chosen), which powers the
simulator and the "why?" view.

## 3. Build order

M1 conditions + expressions + rule model · M2 variables + calculations ·
M3 navigation on the new model (legacy translated) · M4 visibility ·
M5 conditional / cross-field validation · M6 scoring + outcomes ·
then server integration (walk, completion, hidden fields), builder UI
(simple → advanced), simulator + trace, static analysis, recall /
dynamic text, AI-assisted rule writing. Status of each lives in
`PROJECT_STATUS.md`.

## 4. Status (2026-10-02)

Built and tested (unit, integration and E2E as noted in `docs/testing.md`):

| Spec phases      | What exists                                                                                                                                                                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–7, 9–15, 17–18 | Conditions (27 operators, groups, cross-field), actions, typed variables, formulas, branching, visibility, conditional validation, option scoring with weights, outcomes (`go_to_highest`), quizzes, eligibility, lead scoring, segmentation, pricing, date logic |
| 21–22            | Recall (`{{name}}`, `{{answer:qid}}`) in labels, endings and redirects (host kept); URL / hidden fields stored per response                                                                                                                                       |
| 25               | Variables and URL values in the webhook payload (async, as before)                                                                                                                                                                                                |
| 26–29            | Preview simulator with the path, variables and a "why" trace; logic map; static analysis (Check tab; errors block saving)                                                                                                                                         |
| 30–31            | "Describe a rule" and "Describe your form" (Claude). The model fills flat drafts that are translated here and must pass Zod and `analyzeLogic`; the creator accepts or discards. Needs `ANTHROPIC_API_KEY`; off (and says so) without it                          |
| 32–33            | Simple editor by default (sentences, one group level), formulas for advanced use; five logic templates                                                                                                                                                            |
| 37               | Summary view "Results": endings reached, number-variable average/min/max, value shares for text, boolean and list variables — replayed per response with its own version                                                                                          |

Added 2026-10-03:

| Spec phase | What exists                                                                                                                                                                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 19         | Random groups (question pools) and shuffled options, seeded per response                                                                                                                                                                                                                                            |
| 20         | Adaptive groups: a pool whose questions have a difficulty (1–5); asks `pick` one at a time, harder after a right answer and easier after a wrong one (`src/domains/logic/adaptive.ts`). The sequence is derived from the answers and the seed, so browser and server agree                                          |
| 23         | Progressive profiling: questions marked "ask once per person" are filled in and passed over for a visitor who answered the same detail on another of the workspace's forms (`src/domains/responses/profile.ts`). Filled by the runtime, so the engine and the server's walk are unchanged                           |
| 24         | Data lookups: after a chosen question the server calls the creator's API (GET, JSON) and copies fields from the reply into the form's URL fields, which rules, formulas and recall already read (`src/domains/integrations/lookups.ts`). Configured per form on the Integrations page, outside the versioned schema |
| 36         | Benchmarks (`npm run bench:logic`) and budgets (`tests/unit/logic-performance.test.ts`), below                                                                                                                                                                                                                      |

### Performance (phase 36)

The engine replays a response from its answers instead of keeping state,
so the cost that matters is one replay. Measured on an Apple-silicon
laptop (medians; `npm run bench:logic`), at and beyond real form sizes —
the schema allows at most 200 questions and 500 rules:

| Questions × rules | Server walk | Slowest single step | Whole session (every step) | 2,000 replays (Summary cap) |
| ----------------- | ----------- | ------------------- | -------------------------- | --------------------------- |
| 20 × 20           | 0.12 ms     | 0.08 ms             | 1 ms                       | 92 ms                       |
| 50 × 100          | 0.10 ms     | 0.09 ms             | 3 ms                       | 171 ms                      |
| 100 × 200         | 0.36 ms     | 0.31 ms             | 10 ms                      | 405 ms                      |
| 200 × 200         | 0.30 ms     | 0.26 ms             | 28 ms                      | 530 ms                      |
| 100 × 500         | 0.48 ms     | 0.48 ms             | 19 ms                      | 692 ms                      |

A step replays the path so far, so a session is quadratic in the number
of questions — still under 30 ms in total at the maximum. The unit test
holds budgets 25–50× looser than these (25 ms per walk or step, 1 s per
session, 5 s per 500 replays) so only a real regression trips them.

Not built (would each need a decision in `DECISIONS.md` first):
dynamic options from data (8), and automations beyond the existing
webhooks/Sheets/email (25).
