# Canonical Form Schema

Source: `src/domains/forms/schema/*`. This is the single typed
definition of what a form _is_, versioned so old published forms
remain interpretable forever.

## Why JSONB with a strict schema, not one row per question

A form's question list, options, logic, theme, and endings are edited
together, reordered together, and published together as one atomic
unit. Modeling every question/option/rule as its own relational row
would require multi-table transactions for every builder keystroke and
would make "this response belongs to exactly this historical
definition" harder to guarantee. Instead:

- `form_versions.schema` (JSONB) holds the _entire_ versioned
  definition, validated end-to-end by a Zod schema before it is ever
  written.
- The Zod schema is the real contract — JSONB is just the storage
  representation of something strongly typed, not a blob of arbitrary
  shape.
- Question/option/logic-rule ids are stable strings generated at
  creation and never reused, so this is not a naked "give up on
  relational integrity" move — integrity is enforced at the
  validation layer instead of via foreign keys, because the parent
  (`form_versions`) is itself immutable once published.

## Shape (v1)

```ts
FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: string, description?: string },
  theme: ThemeV1,
  endings: EndingV1[],          // at least 1, default ending required
  questions: QuestionV1[],       // stable id, type, order index
  logic: LogicRuleV1[],
}

QuestionV1 = {
  id: string,                    // stable, nanoid, never reused
  type: QuestionType,            // enum, see below
  order: number,
  label: string,
  description?: string,
  required: boolean,
  settings: <type-specific, discriminated on `type`>,
}

LogicRuleV1 = {
  id: string,
  questionId: string,            // must resolve to an existing question
  operator: "equals" | "not_equals" | "contains" | "gt" | "lt"
          | "is_answered" | "is_not_answered",
  value?: JSONValue,
  action: { type: "jump_to_question", questionId: string }
        | { type: "jump_to_ending", endingId: string },
}
```

`QuestionType` (Phase 1, exhaustive):
`welcome_screen`, `short_text`, `long_text`, `email`, `phone`, `url`,
`contact_info`, `number`, `single_select`, `multi_select`, `dropdown`,
`yes_no`, `date`, `rating`, `opinion_scale`, `file_upload`, `statement`.

`contact_info` is lead capture: one step asking for several contact
details. Settings: `fields` (subset of `name`, `email`, `phone`,
`company`, at least one) and `requiredFields` (must be a subset of
`fields`). Its answer is an object `{ name?, email?, phone?, company? }`
holding only the configured fields; required-ness and email/phone
formats are validated per field. Exports (CSV, Sheets) give each field
its own column. Added to v1 additively — older schemas never contain
it, so no migration of stored data is needed.
(`ending` is modeled separately via `endings[]`, not as a question
type, since a form can have multiple endings reachable by logic.)

Each type's `settings` is a discriminated-union member validated
independently (e.g. `short_text` settings: `placeholder?`, `minLength?`,
`maxLength?`; `number` settings: `min?`, `max?`, `decimals?`).

## Validation pipeline (matches `ARCHITECTURE.md`)

1. **Transport decode** — `JSON.parse` with a size cap and NUL/invalid-
   Unicode rejection before anything else runs.
2. **Structural** (`FormSchemaV1Zod.parse`) — types correct, no
   duplicate `question.id`/`ending.id`/`logic.id`.
3. **Semantic** (`validateSemantics`, run on every draft save and on
   publish) — every `logic[].questionId` and jump target resolves to a
   real question/ending; **a `jump_to_question` rule may only target a
   question later in the form** (`backward_jump` — see below);
   option-scoped operators only against option-bearing question types;
   rules that compare to an option must name an option the question
   really has (`dangling_logic_option`); no two options share an id.
   Errors carry a creator-facing message ("Logic rule 2: jumps back to
   an earlier question…"); `message` itself is for logs.
   `validateForPublish` adds one check that only matters live: a rule
   still waiting for its comparison value is refused
   (`incomplete_logic_rule`), though it may be saved as a draft.
4. **Publication compile** — additionally requires: every question is
   reachable from the start under at least one logic path (or no logic
   touches it, meaning default linear order applies), no cycles in the
   jump graph (graph walk with a visited-set, reject on revisit before
   reaching an ending), all endings have at least a title. Produces
   the exact immutable object written to `form_versions.schema` for
   the new published row.
5. **Persistence** — the compiled object, written once, read many
   times, never mutated in place.
6. **Runtime** — builder, preview, and the public runtime all read
   through the same `parseFormSchema()`/`compileFormSchema()`
   functions; there is no second parallel schema reader.

## Backward compatibility

`schemaVersion` is part of the stored object. A future v2 adds a
migration function `upgradeV1ToV2()`; old published `form_versions`
rows are read through a version-dispatching loader so historical
responses stay interpretable without rewriting old rows.

## Logic loop / dangling-reference handling

- **Jumps only go forward.** A rule that jumped back (e.g. "Q3 is
  answered → go to Q2") matched again on the way past Q3 and sent the
  respondent round forever; the static cycle check could not see it
  because Q3 still had a default way out. With forward-only jumps the
  question graph is acyclic by construction. The builder offers only
  later questions as targets, refuses a reorder that would turn a jump
  into a jump back, and validation rejects it server-side.
- **Forms published before that rule keep working.** The compiler does
  not re-validate what it serves, and `evaluateNextStep` takes the set
  of questions already shown: a jump to one of them is ignored and the
  default step skips them, so any walk ends in at most one step per
  question. The browser and `walkForm` (server) use the same function
  and agree on the path — see `tests/unit/logic-properties.test.ts`.
- Deleting a question that a rule references removes those rules after
  a confirmation. Deleting an option removes the rules that checked it
  (with a notice). Moving a question is refused if it would create a
  backward jump.
- The publication compiler still runs reachability and
  strongly-connected-component checks over `{questions, logic, endings}`
  as a second line of defence.
