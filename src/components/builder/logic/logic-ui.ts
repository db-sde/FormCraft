import type {
  ActionV1,
  CompareOperator,
  Condition,
  Expr,
  RuleV1,
  Value,
  VariableV1,
} from "@/domains/forms/schema/logic-model";
import type { FormSchemaV1, QuestionV1 } from "@/domains/forms/schema/v1";
import { CONTACT_FIELD_LABELS } from "@/domains/forms/schema/question-types";
import { printFormula } from "@/domains/logic/formula";
import { formatValue } from "@/domains/logic/recall";

/** What the left side of a comparison is, for picking operators and the
 * value control. */
export type OperandKind =
  | "choice"
  | "multi"
  | "yes_no"
  | "number"
  | "date"
  | "text"
  | "boolean"
  | "list"
  | "unknown";

export const OPERATOR_LABEL: Record<CompareOperator, string> = {
  eq: "is",
  neq: "is not",
  gt: "is greater than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  between: "is between",
  not_between: "is not between",
  contains: "contains",
  not_contains: "does not contain",
  starts_with: "starts with",
  ends_with: "ends with",
  is_empty: "is empty",
  is_not_empty: "is answered",
  any_of: "is any of",
  all_of: "includes all of",
  none_of: "is none of",
  before: "is before",
  after: "is after",
  on: "is on",
  is_today: "is today",
  is_this_week: "is this week",
  is_this_month: "is this month",
  is_weekday: "is a weekday",
  is_weekend: "is a weekend",
  is_true: "is true",
  is_false: "is false",
};

const OPERATORS: Record<OperandKind, CompareOperator[]> = {
  choice: ["eq", "neq", "any_of", "none_of", "is_not_empty", "is_empty"],
  multi: [
    "contains",
    "not_contains",
    "any_of",
    "all_of",
    "none_of",
    "is_not_empty",
    "is_empty",
  ],
  yes_no: ["eq", "is_not_empty", "is_empty"],
  number: [
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "between",
    "not_between",
    "is_not_empty",
    "is_empty",
  ],
  date: [
    "on",
    "before",
    "after",
    "between",
    "is_today",
    "is_this_week",
    "is_this_month",
    "is_weekday",
    "is_weekend",
    "is_not_empty",
    "is_empty",
  ],
  text: [
    "eq",
    "neq",
    "contains",
    "not_contains",
    "starts_with",
    "ends_with",
    "is_not_empty",
    "is_empty",
  ],
  boolean: ["is_true", "is_false"],
  list: ["contains", "not_contains", "is_not_empty", "is_empty"],
  unknown: ["is_not_empty", "is_empty"],
};

export function operatorsFor(kind: OperandKind): CompareOperator[] {
  return OPERATORS[kind];
}

export function questionKind(q: QuestionV1 | undefined, field?: string): OperandKind {
  if (!q) return "unknown";
  if (field) return "text";
  switch (q.type) {
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
    case "file_upload":
    case "contact_info":
      return "unknown";
    default:
      return "text";
  }
}

export function variableKind(v: VariableV1 | undefined): OperandKind {
  if (!v) return "unknown";
  return v.type === "number"
    ? "number"
    : v.type === "boolean"
      ? "boolean"
      : v.type === "date"
        ? "date"
        : v.type === "list"
          ? "list"
          : "text";
}

export function exprKind(expr: Expr, schema: FormSchemaV1): OperandKind {
  if (expr.type === "answer") {
    return questionKind(
      schema.questions.find((q) => q.id === expr.questionId),
      expr.field,
    );
  }
  if (expr.type === "variable") {
    return variableKind((schema.variables ?? []).find((v) => v.id === expr.variableId));
  }
  if (expr.type === "hidden") return "text";
  return "unknown";
}

/** Questions that have an answer to reason about, numbered as in the
 * builder (the welcome screen has no number). */
export function numberedQuestions(schema: FormSchemaV1) {
  const ordered = [...schema.questions].sort((a, b) => a.order - b.order);
  let n = 0;
  return ordered.map((q) => ({
    question: q,
    number: q.type === "welcome_screen" ? 0 : ++n,
  }));
}

export function questionName(schema: FormSchemaV1, id: string, max = 32): string {
  const entry = numberedQuestions(schema).find((e) => e.question.id === id);
  if (!entry) return "a deleted question";
  const label = entry.question.label.trim() || "Untitled question";
  const short = label.length > max ? `${label.slice(0, max - 1)}…` : label;
  return entry.number ? `${entry.number} · ${short}` : short;
}

export function endingName(schema: FormSchemaV1, id: string): string {
  return schema.endings.find((e) => e.id === id)?.title.trim() || "an ending";
}

/** A default comparison for an operand: something that reads sensibly. */
export function defaultCompare(left: Expr, schema: FormSchemaV1): Condition {
  const kind = exprKind(left, schema);
  const op = operatorsFor(kind)[0];
  return { type: "compare", left, op, right: defaultValue(left, op, schema) };
}

export function defaultValue(
  left: Expr,
  op: CompareOperator,
  schema: FormSchemaV1,
): Expr | undefined {
  if (
    [
      "is_empty",
      "is_not_empty",
      "is_today",
      "is_this_week",
      "is_this_month",
      "is_weekday",
      "is_weekend",
      "is_true",
      "is_false",
    ].includes(op)
  ) {
    return undefined;
  }
  const kind = exprKind(left, schema);
  if (left.type === "answer" && (kind === "choice" || kind === "multi")) {
    const q = schema.questions.find((x) => x.id === left.questionId);
    const first =
      (q?.settings as { options?: { id: string }[] }).options?.[0]?.id ?? null;
    return {
      type: "literal",
      value:
        op === "any_of" || op === "all_of" || op === "none_of"
          ? first
            ? [first]
            : []
          : first,
    };
  }
  if (kind === "yes_no") return { type: "literal", value: true };
  if (kind === "number") return { type: "literal", value: 0 };
  return { type: "literal", value: "" };
}

// --- describing ----------------------------------------------------------------

export function describeExpr(expr: Expr, schema: FormSchemaV1): string {
  if (expr.type === "answer") {
    const name = questionName(schema, expr.questionId);
    return expr.field
      ? `${name} · ${CONTACT_FIELD_LABELS[expr.field as keyof typeof CONTACT_FIELD_LABELS] ?? expr.field}`
      : name;
  }
  if (expr.type === "literal") return literalText(expr.value);
  return printFormula(expr, schema);
}

function literalText(value: Value): string {
  if (typeof value === "string") return `“${value}”`;
  return formatValue(value);
}

/** A literal compared with a question's answer, in the creator's terms
 * (option labels, Yes/No). */
function valueText(left: Expr, right: Expr, schema: FormSchemaV1): string {
  if (right.type !== "literal" || left.type !== "answer")
    return describeExpr(right, schema);
  const q = schema.questions.find((x) => x.id === left.questionId);
  const options = (q?.settings as { options?: { id: string; label: string }[] }).options;
  const label = (v: Value) => {
    if (typeof v === "boolean" && q?.type === "yes_no") {
      const s = q.settings as { yesLabel?: string; noLabel?: string };
      return v ? s.yesLabel || "Yes" : s.noLabel || "No";
    }
    const option = options?.find((o) => o.id === v);
    return option ? `“${option.label}”` : literalText(v);
  };
  return Array.isArray(right.value)
    ? right.value.map((v) => label(v)).join(", ")
    : label(right.value);
}

export function describeCondition(condition: Condition, schema: FormSchemaV1): string {
  switch (condition.type) {
    case "all":
    case "any": {
      const parts = condition.conditions.map((c) => describeCondition(c, schema));
      if (parts.length === 0) return condition.type === "all" ? "always" : "never";
      if (parts.length === 1) return parts[0];
      return parts
        .map((p) => (p.includes(" and ") || p.includes(" or ") ? `(${p})` : p))
        .join(condition.type === "all" ? " and " : " or ");
    }
    case "not":
      return `not (${describeCondition(condition.condition, schema)})`;
    case "compare": {
      const left = describeExpr(condition.left, schema);
      const op = OPERATOR_LABEL[condition.op];
      if (!condition.right) return `${left} ${op}`;
      const right = valueText(condition.left, condition.right, schema);
      if (condition.right2) {
        return `${left} ${op} ${right} and ${valueText(condition.left, condition.right2, schema)}`;
      }
      return `${left} ${op} ${right}`;
    }
  }
}

const OP_VERB: Record<string, string> = {
  set: "set",
  add: "add",
  subtract: "subtract",
  multiply: "multiply",
  divide: "divide",
  append: "add to list",
  remove: "remove from list",
};

export function describeAction(action: ActionV1, schema: FormSchemaV1): string {
  switch (action.type) {
    case "jump_to_question":
      return `go to ${questionName(schema, action.questionId)}`;
    case "jump_to_ending":
      return `end with “${endingName(schema, action.endingId)}”`;
    case "go_to_highest":
      return "end with the highest-scoring outcome";
    case "set_variable": {
      const name =
        (schema.variables ?? []).find((v) => v.id === action.variableId)?.name ??
        "a variable";
      const value = describeExpr(action.value, schema);
      if (action.op === "set") return `set ${name} to ${value}`;
      if (action.op === "add") return `add ${value} to ${name}`;
      if (action.op === "subtract") return `subtract ${value} from ${name}`;
      if (action.op === "multiply") return `multiply ${name} by ${value}`;
      if (action.op === "divide") return `divide ${name} by ${value}`;
      return `${OP_VERB[action.op]} ${name}: ${value}`;
    }
  }
}

export function describeTrigger(rule: RuleV1, schema: FormSchemaV1): string {
  if (rule.on.event === "form_started") return "When the form starts";
  if (rule.on.event === "form_completed") return "When the form is completed";
  return `After ${questionName(schema, rule.on.questionId)}`;
}

export function describeRule(rule: RuleV1, schema: FormSchemaV1): string {
  const when = rule.when ? `if ${describeCondition(rule.when, schema)}, ` : "";
  return `${describeTrigger(rule, schema)}: ${when}${rule.then
    .map((a) => describeAction(a, schema))
    .join(", then ")}`;
}
