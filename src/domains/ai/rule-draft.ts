import { z } from "zod";
import { nanoid } from "nanoid";
import {
  COMPARE_OPERATORS,
  RANGE_COMPARE_OPERATORS,
  RuleV1,
  UNARY_COMPARE_OPERATORS,
  VARIABLE_OPERATIONS,
  variableName,
  type ActionV1,
  type Condition,
  type Expr,
  type VariableV1,
} from "@/domains/forms/schema/logic-model";
import type { FormSchemaV1, QuestionV1 } from "@/domains/forms/schema/v1";
import { CONTACT_FIELDS } from "@/domains/forms/schema/question-types";
import { analyzeLogic } from "@/domains/forms/schema/analyze";
import { parseFormula } from "@/domains/logic/formula";

/**
 * Natural-language logic (Phase 30). The model never writes the engine's
 * AST: it fills this flat draft, where questions are referred to by
 * number, variables by name and values in the creator's words (option
 * labels, "yes"). The draft is then translated here — deterministically,
 * against the form as it is — and the result must pass the same Zod
 * schema and static analysis as a hand-built rule before the creator can
 * accept it. Flat because structured outputs can't express recursion;
 * one level of All/Any covers what people describe in a sentence.
 */

const VARIABLE_DRAFT_TYPES = ["number", "string", "boolean", "list"] as const;

export const RuleDraft = z.object({
  possible: z
    .boolean()
    .describe("False when the request can't be expressed with this form's logic."),
  reason: z
    .string()
    .describe("When not possible: why, in one plain sentence. Otherwise empty."),
  name: z
    .string()
    .describe("A short name for the rule, e.g. “Skip pricing for students”."),
  trigger: z.object({
    event: z.enum(["question_answered", "form_started", "form_completed"]),
    questionNumber: z
      .number()
      .int()
      .nullable()
      .describe("For question_answered: the question's number."),
  }),
  match: z.enum(["all", "any"]),
  conditions: z
    .array(
      z.object({
        left: z
          .string()
          .describe("What to check: q3, q2.email, a variable name or a URL field name."),
        op: z.enum(COMPARE_OPERATORS),
        value: z
          .string()
          .nullable()
          .describe(
            "The value in the creator's words: an option label, yes/no, a number, a YYYY-MM-DD date or text. Null for operators that need none.",
          ),
        values: z
          .array(z.string())
          .describe("For any_of / all_of / none_of: the option labels. Otherwise []."),
        value2: z
          .string()
          .nullable()
          .describe("For between / not_between: the upper bound."),
        valueIsFormula: z
          .boolean()
          .describe("True when value is a formula (e.g. q4 to compare two answers)."),
      }),
    )
    .describe("Empty means the rule always runs."),
  actions: z.array(
    z.object({
      type: z.enum([
        "jump_to_question",
        "jump_to_ending",
        "set_variable",
        "go_to_highest",
      ]),
      questionNumber: z.number().int().nullable(),
      endingId: z.string().nullable(),
      variable: z.string().nullable().describe("For set_variable: the variable's name."),
      op: z.enum(VARIABLE_OPERATIONS).nullable(),
      formula: z
        .string()
        .nullable()
        .describe("For set_variable: the value as a formula, e.g. 10 or score + q3 * 2."),
      candidates: z
        .array(z.object({ variable: z.string(), endingId: z.string() }))
        .describe("For go_to_highest: variable → ending pairs. Otherwise []."),
    }),
  ),
  newVariables: z
    .array(
      z.object({
        name: z.string(),
        type: z.enum(VARIABLE_DRAFT_TYPES),
        initial: z.number().nullable(),
      }),
    )
    .describe("Variables the rule needs that the form doesn't have yet."),
});
export type RuleDraft = z.infer<typeof RuleDraft>;

export type RuleProposal = {
  rule: RuleV1;
  newVariables: VariableV1[];
  warnings: string[];
};

export type DraftResult =
  { ok: true; proposal: RuleProposal } | { ok: false; message: string };

function ordered(schema: FormSchemaV1): QuestionV1[] {
  return [...schema.questions]
    .sort((a, b) => a.order - b.order)
    .filter((q) => q.type !== "welcome_screen");
}

function options(q: QuestionV1): { id: string; label: string }[] {
  return (q.settings as { options?: { id: string; label: string }[] }).options ?? [];
}

/** The form, as the model reads it: numbered questions with their
 * options, variables, URL fields and endings. Ids only where the draft
 * uses them (endings). */
export function describeFormForAi(schema: FormSchemaV1): string {
  const lines: string[] = [`Form: ${schema.meta.title}`, "", "Questions:"];
  ordered(schema).forEach((q, i) => {
    let line = `q${i + 1} [${q.type}] ${q.label.trim() || "Untitled"}`;
    if (q.visibleIf) line += " (shown only sometimes)";
    lines.push(line);
    for (const o of options(q)) lines.push(`    option: ${o.label}`);
    if (q.type === "contact_info") {
      const fields = (q.settings as { fields?: string[] }).fields ?? CONTACT_FIELDS;
      lines.push(`    fields: ${fields.map((f) => `q${i + 1}.${f}`).join(", ")}`);
    }
    if (q.type === "rating") {
      lines.push(`    scale: 1–${(q.settings as { scale?: number }).scale ?? 5}`);
    }
    if (q.type === "opinion_scale") {
      const s = q.settings as { min?: number; max?: number };
      lines.push(`    scale: ${s.min ?? 0}–${s.max ?? 10}`);
    }
  });
  const variables = schema.variables ?? [];
  lines.push("", "Variables:");
  if (variables.length === 0) lines.push("(none)");
  for (const v of variables) lines.push(`${v.name} [${v.type}]`);
  const hidden = schema.hiddenFields ?? [];
  if (hidden.length > 0) {
    lines.push("", "URL fields:");
    for (const h of hidden) lines.push(h.name);
  }
  lines.push("", "Endings:");
  for (const e of schema.endings) {
    lines.push(
      `${e.id}: ${e.title.trim() || "Untitled"}${e.isDefault ? " (default)" : ""}`,
    );
  }
  return lines.join("\n");
}

type Kind = "choice" | "multi" | "yes_no" | "number" | "date" | "boolean" | "text";

function kindOf(expr: Expr, schema: FormSchemaV1): Kind {
  if (expr.type === "answer") {
    if (expr.field) return "text";
    const q = schema.questions.find((x) => x.id === expr.questionId);
    switch (q?.type) {
      case "single_select":
      case "dropdown":
        return "choice";
      case "multi_select":
        return "multi";
      case "yes_no":
        return "yes_no";
      case "number":
      case "rating":
      case "opinion_scale":
        return "number";
      case "date":
        return "date";
      default:
        return "text";
    }
  }
  if (expr.type === "variable") {
    const v = (schema.variables ?? []).find((x) => x.id === expr.variableId);
    if (v?.type === "number") return "number";
    if (v?.type === "boolean") return "boolean";
    if (v?.type === "date") return "date";
    if (v?.type === "list") return "multi";
    return "text";
  }
  return expr.type === "literal" && typeof expr.value === "number" ? "number" : "text";
}

class DraftError extends Error {}

function formula(text: string, schema: FormSchemaV1, what: string): Expr {
  const parsed = parseFormula(text, schema);
  if (!parsed.ok) throw new DraftError(`${what} “${text}”: ${parsed.message}`);
  return parsed.expr;
}

/** One value in the creator's words → a literal the engine compares. */
function literal(raw: string, left: Expr, schema: FormSchemaV1): Expr {
  const kind = kindOf(left, schema);
  const text = raw.trim();
  if ((kind === "choice" || kind === "multi") && left.type === "answer") {
    const q = schema.questions.find((x) => x.id === left.questionId)!;
    const option = options(q).find(
      (o) => o.id === text || o.label.trim().toLowerCase() === text.toLowerCase(),
    );
    if (!option) throw new DraftError(`“${text}” isn't an option of “${q.label}”.`);
    return { type: "literal", value: option.id };
  }
  if (kind === "yes_no" || kind === "boolean") {
    if (/^(yes|true)$/i.test(text)) return { type: "literal", value: true };
    if (/^(no|false)$/i.test(text)) return { type: "literal", value: false };
    throw new DraftError(`“${text}” isn't yes or no.`);
  }
  if (kind === "number") {
    const n = Number(text);
    if (text === "" || !Number.isFinite(n))
      throw new DraftError(`“${text}” isn't a number.`);
    return { type: "literal", value: n };
  }
  if (kind === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new DraftError(`“${text}” isn't a date (YYYY-MM-DD).`);
  }
  return { type: "literal", value: raw };
}

function condition(
  c: RuleDraft["conditions"][number],
  schema: FormSchemaV1,
): Extract<Condition, { type: "compare" }> {
  const left = formula(c.left, schema, "What to check");
  if (UNARY_COMPARE_OPERATORS.has(c.op)) return { type: "compare", left, op: c.op };
  const value = (raw: string | null, label: string): Expr => {
    if (raw === null)
      throw new DraftError(`A condition on “${c.left}” is missing ${label}.`);
    return c.valueIsFormula ? formula(raw, schema, "Value") : literal(raw, left, schema);
  };
  if (c.op === "any_of" || c.op === "all_of" || c.op === "none_of") {
    const list = c.values.length > 0 ? c.values : c.value ? [c.value] : [];
    if (list.length === 0)
      throw new DraftError(`A condition on “${c.left}” lists no options.`);
    const ids = list.map((v) => (literal(v, left, schema) as { value: string }).value);
    return { type: "compare", left, op: c.op, right: { type: "literal", value: ids } };
  }
  const compare: Extract<Condition, { type: "compare" }> = {
    type: "compare",
    left,
    op: c.op,
    right: value(c.value, "its value"),
  };
  if (RANGE_COMPARE_OPERATORS.has(c.op))
    compare.right2 = value(c.value2, "its upper bound");
  return compare;
}

function questionAt(n: number | null, schema: FormSchemaV1): QuestionV1 {
  const q = n === null ? undefined : ordered(schema)[n - 1];
  if (!q) throw new DraftError(`There's no question ${n ?? "(missing)"}.`);
  return q;
}

function endingId(id: string | null, schema: FormSchemaV1): string {
  const ending = schema.endings.find((e) => e.id === id);
  if (!ending) throw new DraftError(`There's no ending “${id ?? "(missing)"}”.`);
  return ending.id;
}

function variableId(name: string | null, schema: FormSchemaV1): string {
  const v = (schema.variables ?? []).find((x) => x.name === name);
  if (!v) throw new DraftError(`There's no variable “${name ?? "(missing)"}”.`);
  return v.id;
}

function action(a: RuleDraft["actions"][number], schema: FormSchemaV1): ActionV1 {
  switch (a.type) {
    case "jump_to_question":
      return {
        type: "jump_to_question",
        questionId: questionAt(a.questionNumber, schema).id,
      };
    case "jump_to_ending":
      return { type: "jump_to_ending", endingId: endingId(a.endingId, schema) };
    case "set_variable":
      if (a.formula === null) throw new DraftError("Setting a variable needs a value.");
      return {
        type: "set_variable",
        variableId: variableId(a.variable, schema),
        op: a.op ?? "set",
        value: formula(a.formula, schema, "Value"),
      };
    case "go_to_highest":
      if (a.candidates.length === 0) throw new DraftError("Pick outcomes to compare.");
      return {
        type: "go_to_highest",
        candidates: a.candidates.map((c) => ({
          variableId: variableId(c.variable, schema),
          endingId: endingId(c.endingId, schema),
        })),
      };
  }
}

/**
 * The draft → a rule (and any variables it introduces), checked as the
 * builder checks a hand-made rule. Never throws: problems come back as a
 * message the model can be asked to fix, or the creator can read.
 */
export function draftToRule(draft: RuleDraft, schema: FormSchemaV1): DraftResult {
  if (!draft.possible) {
    return {
      ok: false,
      message: draft.reason || "That can't be done with this form's logic.",
    };
  }
  try {
    const existing = new Set((schema.variables ?? []).map((v) => v.name));
    const newVariables: VariableV1[] = [];
    for (const v of draft.newVariables) {
      if (existing.has(v.name)) continue;
      if (!variableName.safeParse(v.name).success) {
        throw new DraftError(
          `“${v.name}” can't be a variable name: use lowercase letters, numbers and _.`,
        );
      }
      existing.add(v.name);
      newVariables.push({
        id: `v_${nanoid(10)}`,
        name: v.name,
        type: v.type,
        ...(v.type === "number" && v.initial !== null ? { initial: v.initial } : {}),
      });
    }
    const withVariables: FormSchemaV1 = {
      ...schema,
      variables: [...(schema.variables ?? []), ...newVariables],
    };

    const on: RuleV1["on"] =
      draft.trigger.event === "question_answered"
        ? {
            event: "question_answered",
            questionId: questionAt(draft.trigger.questionNumber, withVariables).id,
          }
        : { event: draft.trigger.event };
    const conditions = draft.conditions.map((c) => condition(c, withVariables));
    if (draft.actions.length === 0) throw new DraftError("The rule doesn't do anything.");
    const parsed = RuleV1.safeParse({
      id: `r_${nanoid(10)}`,
      name: draft.name.trim().slice(0, 120) || undefined,
      on,
      when:
        conditions.length === 0
          ? undefined
          : conditions.length === 1
            ? conditions[0]
            : { type: draft.match, conditions },
      then: draft.actions.map((a) => action(a, withVariables)),
    });
    if (!parsed.success) {
      return {
        ok: false,
        message: parsed.error.issues[0]?.message ?? "The rule isn't valid.",
      };
    }
    const rule = parsed.data;

    // The same analysis that guards saving, on the form with the rule in.
    const issues = analyzeLogic({
      ...withVariables,
      rules: [...(schema.rules ?? []), rule],
    }).filter((i) => i.ruleId === rule.id);
    const error = issues.find((i) => i.severity === "error");
    if (error) return { ok: false, message: error.message };
    return {
      ok: true,
      proposal: { rule, newVariables, warnings: issues.map((i) => i.message) },
    };
  } catch (error) {
    if (error instanceof DraftError) return { ok: false, message: error.message };
    throw error;
  }
}
