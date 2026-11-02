import { z } from "zod";
import { nanoid } from "nanoid";
import type { FormSchemaV1, QuestionV1 } from "@/domains/forms/schema/v1";
import { ThemeV1 } from "@/domains/forms/schema/v1";
import { createOption, createQuestion } from "@/domains/forms/builder";
import {
  parseFormSchema,
  validateSemantics,
  FormSchemaError,
  schemaErrorMessage,
} from "@/domains/forms/schema/validate";
import { analyzeLogic } from "@/domains/forms/schema/analyze";
import { draftToRule, RuleDraft } from "./rule-draft";

/**
 * AI form editing (master spec F-23) — the part that never talks to a
 * model. The model fills an `EditDraft` (a list of operations on the form
 * as the creator described it); `applyEdit` turns that into a new draft
 * schema with the same checks a hand edit gets, and `describeChanges`
 * lists what would change, for the creator to review before anything is
 * applied. Rejected or failing edits leave the form as it was.
 *
 * Question numbers in the draft always refer to the form as it is before
 * the edit (welcome screen not counted), so a multi-step instruction
 * ("delete 3 and reword 5") doesn't shift under itself.
 */

const EDIT_TYPES = [
  "short_text",
  "long_text",
  "email",
  "phone",
  "url",
  "number",
  "single_select",
  "multi_select",
  "dropdown",
  "yes_no",
  "date",
  "rating",
  "opinion_scale",
  "statement",
] as const;
const CHOICE_TYPES = new Set(["single_select", "multi_select", "dropdown"]);

const FONTS = ThemeV1.shape.fontFamily.unwrap().options.filter((f) => f !== "custom");

export const EditOperation = z.object({
  op: z.enum([
    "update_question",
    "add_question",
    "delete_question",
    "move_question",
    "set_theme",
    "set_title",
    "update_ending",
    "add_rule",
  ]),
  questionNumber: z
    .number()
    .int()
    .nullable()
    .describe("update/delete/move: the question's number in the form as it is now."),
  afterNumber: z
    .number()
    .int()
    .nullable()
    .describe("add/move: place it after this question number (0 = first)."),
  type: z.enum(EDIT_TYPES).nullable().describe("add: the new question's type."),
  label: z.string().nullable().describe("add/update: the question text."),
  description: z
    .string()
    .nullable()
    .describe("add/update: help text; empty string removes it."),
  required: z.boolean().nullable(),
  options: z
    .array(z.string())
    .describe("Choice questions: the full option list in order. [] = leave as is."),
  title: z
    .string()
    .nullable()
    .describe("set_title: the form's title. update_ending: its title."),
  endingId: z.string().nullable().describe("update_ending: which ending."),
  primaryColor: z.string().nullable().describe("set_theme: #rrggbb"),
  backgroundColor: z.string().nullable().describe("set_theme: #rrggbb"),
  fontFamily: z.enum(FONTS as [string, ...string[]]).nullable(),
  buttonStyle: z.enum(["rounded", "square", "pill"]).nullable(),
  rule: RuleDraft.nullable().describe(
    "add_rule: the rule, with question numbers as the form will be after the other operations.",
  ),
});
export type EditOperation = z.infer<typeof EditOperation>;

export const EditDraft = z.object({
  possible: z
    .boolean()
    .describe("False when the request can't be done with this builder."),
  reason: z
    .string()
    .describe("When not possible: why, in one sentence. Otherwise empty."),
  summary: z.string().describe("One sentence on what the edit does."),
  operations: z.array(EditOperation).max(40),
});
export type EditDraft = z.infer<typeof EditDraft>;

export type EditResult =
  | { ok: true; schema: FormSchemaV1; changes: string[]; summary: string }
  | { ok: false; message: string };

class EditError extends Error {}

const clip = (text: string | null | undefined, max: number) =>
  (text ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, max);

function ordered(questions: QuestionV1[]) {
  return [...questions].sort((a, b) => a.order - b.order);
}

/** Questions as the creator numbers them: welcome screen not counted. */
function numbered(schema: FormSchemaV1): QuestionV1[] {
  return ordered(schema.questions).filter((q) => q.type !== "welcome_screen");
}

function idAt(original: QuestionV1[], n: number | null, what: string): string {
  const q = n === null ? undefined : original[n - 1];
  if (!q) throw new EditError(`There's no question ${n ?? "(missing)"} to ${what}.`);
  return q.id;
}

/** New options, keeping the id of any option whose label stays. */
function withOptions(question: QuestionV1, labels: string[]): QuestionV1 {
  const current =
    (question.settings as { options?: { id: string; label: string }[] }).options ?? [];
  const used = new Set<string>();
  const options = labels
    .map((l) => clip(l, 500))
    .filter(Boolean)
    .slice(0, 100)
    .map((label) => {
      const match = current.find(
        (o) => !used.has(o.id) && o.label.trim().toLowerCase() === label.toLowerCase(),
      );
      if (match) {
        used.add(match.id);
        return { ...match, label };
      }
      return createOption(label);
    });
  if (options.length === 0)
    throw new EditError(`“${question.label}” needs at least one option.`);
  return { ...question, settings: { ...question.settings, options } } as QuestionV1;
}

/** Applies a draft to a schema: new schema and what changed, or why not. */
export function applyEdit(schema: FormSchemaV1, draft: EditDraft): EditResult {
  if (!draft.possible) {
    return {
      ok: false,
      message: draft.reason || "That can't be done with this builder.",
    };
  }
  if (draft.operations.length === 0)
    return { ok: false, message: "No changes came back." };
  try {
    const original = numbered(schema);
    let questions = ordered(schema.questions).map((q) => ({ ...q }));
    let next: FormSchemaV1 = {
      ...schema,
      theme: { ...schema.theme },
      meta: { ...schema.meta },
    };
    const rules: RuleDraft[] = [];
    // Placement is by question id, resolved against the original form.
    const placeAfter = (id: string | null, insert: QuestionV1[]) => {
      questions = questions.filter((q) => !insert.some((x) => x.id === q.id));
      const welcomeAt = questions.findIndex((q) => q.type === "welcome_screen");
      const at =
        id === null ? welcomeAt + 1 : questions.findIndex((q) => q.id === id) + 1;
      questions.splice(at <= 0 ? (welcomeAt >= 0 ? welcomeAt + 1 : 0) : at, 0, ...insert);
    };
    const anchor = (n: number | null) =>
      n === null || n === 0 ? null : idAt(original, n, "place it after");

    for (const op of draft.operations) {
      switch (op.op) {
        case "update_question": {
          const id = idAt(original, op.questionNumber, "change");
          questions = questions.map((q) => {
            if (q.id !== id) return q;
            let updated: QuestionV1 = {
              ...q,
              ...(op.label !== null && clip(op.label, 1000)
                ? { label: clip(op.label, 1000) }
                : {}),
              ...(op.description !== null
                ? { description: clip(op.description, 2000) || undefined }
                : {}),
              ...(op.required !== null && q.type !== "statement"
                ? { required: op.required }
                : {}),
            } as QuestionV1;
            if (op.options.length > 0) {
              if (!CHOICE_TYPES.has(q.type) && q.type !== "ranking") {
                throw new EditError(`“${q.label}” doesn't have options.`);
              }
              updated = withOptions(updated, op.options);
            }
            return updated;
          });
          break;
        }
        case "add_question": {
          if (!op.type) throw new EditError("A new question needs a type.");
          let q: QuestionV1 = {
            ...createQuestion(op.type, 0),
            label: clip(op.label, 1000) || "Untitled question",
            description: clip(op.description, 2000) || undefined,
            required: op.type === "statement" ? false : (op.required ?? false),
          } as QuestionV1;
          if (CHOICE_TYPES.has(op.type) && op.options.length > 0)
            q = withOptions(q, op.options);
          placeAfter(anchor(op.afterNumber), [q]);
          break;
        }
        case "delete_question": {
          const id = idAt(original, op.questionNumber, "delete");
          questions = questions.filter((q) => q.id !== id);
          break;
        }
        case "move_question": {
          const id = idAt(original, op.questionNumber, "move");
          const moving = questions.find((q) => q.id === id);
          if (moving) placeAfter(anchor(op.afterNumber), [moving]);
          break;
        }
        case "set_theme": {
          const theme = { ...next.theme };
          if (op.primaryColor) theme.primaryColor = op.primaryColor;
          if (op.backgroundColor) theme.backgroundColor = op.backgroundColor;
          if (op.fontFamily) theme.fontFamily = op.fontFamily as typeof theme.fontFamily;
          if (op.buttonStyle) theme.buttonStyle = op.buttonStyle;
          if (!ThemeV1.safeParse(theme).success)
            throw new EditError("Colours must look like #1d4ed8.");
          next = { ...next, theme };
          break;
        }
        case "set_title": {
          const title = clip(op.title, 200);
          if (!title) throw new EditError("The new title is empty.");
          next = { ...next, meta: { ...next.meta, title } };
          break;
        }
        case "update_ending": {
          const ending = next.endings.find((e) => e.id === op.endingId);
          if (!ending) throw new EditError(`There's no ending “${op.endingId ?? ""}”.`);
          next = {
            ...next,
            endings: next.endings.map((e) =>
              e.id === ending.id
                ? {
                    ...e,
                    ...(clip(op.title, 200) ? { title: clip(op.title, 200) } : {}),
                    ...(op.description !== null
                      ? { description: clip(op.description, 2000) || undefined }
                      : {}),
                  }
                : e,
            ),
          };
          break;
        }
        case "add_rule":
          if (!op.rule) throw new EditError("A rule came back empty.");
          rules.push(op.rule);
          break;
      }
    }

    next = parseFormSchema({
      ...next,
      questions: questions.map((q, order) => ({ ...q, order })),
    });
    // Rules last, against the edited form, checked like hand-made ones.
    for (const rule of rules) {
      const result = draftToRule(rule, next);
      if (!result.ok) throw new EditError(`A rule couldn't be added: ${result.message}`);
      next = {
        ...next,
        rules: [...(next.rules ?? []), result.proposal.rule],
        variables: [...(next.variables ?? []), ...result.proposal.newVariables],
      };
    }
    validateSemantics(next);
    const blocking = analyzeLogic(next).find((i) => i.severity === "error");
    if (blocking) throw new EditError(blocking.message);
    const changes = describeChanges(schema, next);
    if (changes.length === 0)
      return { ok: false, message: "That wouldn't change anything." };
    return { ok: true, schema: next, changes, summary: clip(draft.summary, 300) };
  } catch (error) {
    if (error instanceof EditError) return { ok: false, message: error.message };
    if (error instanceof FormSchemaError) {
      return {
        ok: false,
        message: schemaErrorMessage(error) ?? "The edit didn't pass the form's checks.",
      };
    }
    return { ok: false, message: "The edit didn't pass the form's checks." };
  }
}

const label = (q: QuestionV1) => `“${q.label.trim() || "Untitled"}”`;

/** What changed between two versions of a form, in plain words. */
export function describeChanges(before: FormSchemaV1, after: FormSchemaV1): string[] {
  const out: string[] = [];
  if (before.meta.title !== after.meta.title) {
    out.push(`Title: “${before.meta.title}” → “${after.meta.title}”`);
  }
  const old = new Map(before.questions.map((q) => [q.id, q]));
  const now = new Map(after.questions.map((q) => [q.id, q]));
  for (const q of before.questions) if (!now.has(q.id)) out.push(`Removed ${label(q)}`);
  const afterOrder = ordered(after.questions)
    .map((q) => q.id)
    .filter((id) => old.has(id));
  const beforeOrder = ordered(before.questions)
    .map((q) => q.id)
    .filter((id) => now.has(id));
  ordered(after.questions).forEach((q, i) => {
    const was = old.get(q.id);
    if (!was) {
      out.push(`Added ${label(q)} (${q.type.replace(/_/g, " ")}) as question ${i}`);
      return;
    }
    if (was.label !== q.label) out.push(`Reworded ${label(was)} → ${label(q)}`);
    if ((was.description ?? "") !== (q.description ?? "")) {
      out.push(
        q.description
          ? `New help text on ${label(q)}`
          : `Removed the help text on ${label(q)}`,
      );
    }
    if (was.required !== q.required)
      out.push(`${label(q)} is now ${q.required ? "required" : "optional"}`);
    const wasOptions = (
      (was.settings as { options?: { label: string }[] }).options ?? []
    ).map((o) => o.label);
    const nowOptions = (
      (q.settings as { options?: { label: string }[] }).options ?? []
    ).map((o) => o.label);
    if (wasOptions.join("\u0000") !== nowOptions.join("\u0000")) {
      out.push(`Options of ${label(q)}: ${nowOptions.join(", ") || "none"}`);
    }
  });
  if (beforeOrder.join() !== afterOrder.join()) out.push("Changed the question order");
  const themeKeys = [
    "primaryColor",
    "backgroundColor",
    "fontFamily",
    "buttonStyle",
  ] as const;
  for (const key of themeKeys) {
    if (before.theme[key] !== after.theme[key]) {
      out.push(
        `Theme ${key.replace(/([A-Z])/g, " $1").toLowerCase()}: ${before.theme[key]} → ${after.theme[key]}`,
      );
    }
  }
  for (const e of after.endings) {
    const was = before.endings.find((x) => x.id === e.id);
    if (
      was &&
      (was.title !== e.title || (was.description ?? "") !== (e.description ?? ""))
    ) {
      out.push(`Changed the ending “${was.title}”`);
    }
  }
  const added = (after.rules?.length ?? 0) - (before.rules?.length ?? 0);
  if (added > 0) {
    for (const rule of (after.rules ?? []).slice(-added))
      out.push(`Added the rule “${rule.name ?? "Unnamed"}”`);
  }
  return out;
}

/** The form's theme, for the model's description. */
export function describeThemeForAi(schema: FormSchemaV1): string {
  const t = schema.theme;
  return `Theme: primary ${t.primaryColor}, background ${t.backgroundColor}, font ${t.fontFamily}, buttons ${t.buttonStyle}. Fonts available: ${FONTS.join(", ")}.`;
}

export const newEditId = () => `edit_${nanoid(8)}`;
