import type { FormSchemaV1, QuestionV1 } from "./v1";
import {
  NAVIGATION_ACTIONS,
  RANGE_COMPARE_OPERATORS,
  UNARY_COMPARE_OPERATORS,
  type ActionV1,
  type Condition,
  type Expr,
  type RuleV1,
} from "./logic-model";
import { CONTACT_FIELDS } from "./question-types";

/**
 * Static analysis of a form's logic (docs/logic-engine.md): broken
 * references, backward jumps, type mistakes and conditions that can
 * never be true. Errors block saving (validateSemantics throws the first
 * one); warnings are shown in the builder and at publish.
 */
export type LogicIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  questionId?: string;
  ruleId?: string;
};

const MAX_DEPTH = 12;
const CHOICE_TYPES = new Set(["single_select", "multi_select", "dropdown"]);
const OPTION_COMPARE_OPS = new Set([
  "eq",
  "neq",
  "contains",
  "not_contains",
  "any_of",
  "all_of",
  "none_of",
]);

type Ctx = {
  schema: FormSchemaV1;
  ordered: QuestionV1[];
  position: Map<string, number>;
  questions: Map<string, QuestionV1>;
  variables: Map<string, NonNullable<FormSchemaV1["variables"]>[number]>;
  hidden: Set<string>;
  endings: Set<string>;
  issues: LogicIssue[];
};

function number(ctx: Ctx, questionId: string) {
  return (ctx.position.get(questionId) ?? 0) + 1;
}

function ruleLabel(ctx: Ctx, rule: RuleV1) {
  const index = (ctx.schema.rules ?? []).indexOf(rule);
  return rule.name?.trim() ? `Rule “${rule.name.trim()}”` : `Rule ${index + 1}`;
}

/** Visits every expression inside a condition. */
function conditionExprs(condition: Condition, out: Expr[] = []): Expr[] {
  switch (condition.type) {
    case "all":
    case "any":
      condition.conditions.forEach((c) => conditionExprs(c, out));
      break;
    case "not":
      conditionExprs(condition.condition, out);
      break;
    case "compare":
      out.push(condition.left);
      if (condition.right) out.push(condition.right);
      if (condition.right2) out.push(condition.right2);
      break;
  }
  return out;
}

function depthOf(node: Expr | Condition): number {
  switch (node.type) {
    case "binary":
      return 1 + Math.max(depthOf(node.left), depthOf(node.right));
    case "call":
      return 1 + Math.max(0, ...node.args.map(depthOf));
    case "all":
    case "any":
      return 1 + Math.max(0, ...node.conditions.map(depthOf));
    case "not":
      return 1 + depthOf(node.condition);
    case "compare":
      return (
        1 +
        Math.max(
          depthOf(node.left),
          node.right ? depthOf(node.right) : 0,
          node.right2 ? depthOf(node.right2) : 0,
        )
      );
    default:
      return 1;
  }
}

/** Checks the references an expression makes. `where` names the owner. */
function checkExpr(
  ctx: Ctx,
  expr: Expr,
  where: { label: string; questionId?: string; ruleId?: string },
) {
  const error = (code: string, message: string) =>
    ctx.issues.push({
      severity: "error",
      code,
      message: `${where.label}: ${message}`,
      questionId: where.questionId,
      ruleId: where.ruleId,
    });

  switch (expr.type) {
    case "answer": {
      const q = ctx.questions.get(expr.questionId);
      if (!q) {
        error("missing_question", "it uses a question that was deleted.");
      } else if (q.type === "welcome_screen" || q.type === "statement") {
        error("not_answerable", `question ${number(ctx, q.id)} doesn't take an answer.`);
      } else if (expr.field) {
        if (q.type !== "contact_info" || !CONTACT_FIELDS.includes(expr.field as never)) {
          error(
            "missing_field",
            `question ${number(ctx, q.id)} has no “${expr.field}” field.`,
          );
        }
      }
      break;
    }
    case "variable":
      if (!ctx.variables.has(expr.variableId)) {
        error("missing_variable", "it uses a variable that doesn't exist.");
      }
      break;
    case "hidden":
      if (!ctx.hidden.has(expr.name)) {
        error(
          "missing_hidden_field",
          `“${expr.name}” isn't one of the form's URL fields.`,
        );
      }
      break;
    case "binary":
      checkExpr(ctx, expr.left, where);
      checkExpr(ctx, expr.right, where);
      if (
        (expr.op === "/" || expr.op === "%") &&
        expr.right.type === "literal" &&
        expr.right.value === 0
      ) {
        error("division_by_zero", "it divides by zero.");
      }
      break;
    case "call":
      expr.args.forEach((a) => checkExpr(ctx, a, where));
      break;
    case "literal":
      break;
  }
}

function checkCondition(
  ctx: Ctx,
  condition: Condition,
  where: { label: string; questionId?: string; ruleId?: string },
) {
  if (depthOf(condition) > MAX_DEPTH) {
    ctx.issues.push({
      severity: "error",
      code: "too_deep",
      message: `${where.label}: the condition is nested too deeply. Simplify it.`,
      questionId: where.questionId,
      ruleId: where.ruleId,
    });
    return;
  }
  conditionExprs(condition).forEach((e) => checkExpr(ctx, e, where));
  checkComparisons(ctx, condition, where);
  const impossible = findImpossible(condition);
  if (impossible) {
    ctx.issues.push({
      severity: "warning",
      code: "impossible_condition",
      message: `${where.label}: ${impossible}`,
      questionId: where.questionId,
      ruleId: where.ruleId,
    });
  }
}

/** Option ids compared against a choice answer must exist; operators
 * that need a value must have one. */
function checkComparisons(
  ctx: Ctx,
  condition: Condition,
  where: { label: string; questionId?: string; ruleId?: string },
) {
  if (condition.type === "all" || condition.type === "any") {
    condition.conditions.forEach((c) => checkComparisons(ctx, c, where));
    return;
  }
  if (condition.type === "not") {
    checkComparisons(ctx, condition.condition, where);
    return;
  }
  const { left, op, right, right2 } = condition;
  if (!UNARY_COMPARE_OPERATORS.has(op) && !right) {
    ctx.issues.push({
      severity: "error",
      code: "missing_value",
      message: `${where.label}: choose a value to compare against.`,
      questionId: where.questionId,
      ruleId: where.ruleId,
    });
  }
  if (RANGE_COMPARE_OPERATORS.has(op) && !right2) {
    ctx.issues.push({
      severity: "error",
      code: "missing_value",
      message: `${where.label}: “between” needs a lowest and a highest value.`,
      questionId: where.questionId,
      ruleId: where.ruleId,
    });
  }
  if (
    left.type !== "answer" ||
    !right ||
    right.type !== "literal" ||
    !OPTION_COMPARE_OPS.has(op)
  ) {
    return;
  }
  const q = ctx.questions.get(left.questionId);
  if (!q || !CHOICE_TYPES.has(q.type)) return;
  const options = new Set(
    ((q.settings as { options?: { id: string }[] }).options ?? []).map((o) => o.id),
  );
  const values = Array.isArray(right.value) ? right.value : [right.value];
  if (values.some((v) => v !== null && !options.has(String(v)))) {
    ctx.issues.push({
      severity: "error",
      code: "missing_option",
      message: `${where.label}: it checks an option question ${number(ctx, q.id)} no longer has. Choose it again.`,
      questionId: where.questionId,
      ruleId: where.ruleId,
    });
  }
}

/** Contradictory numeric bounds on the same answer/variable inside an
 * `all` (e.g. age > 50 and age < 20). Returns a message, or null. */
function findImpossible(condition: Condition): string | null {
  if (condition.type === "any" || condition.type === "not") {
    return condition.type === "any"
      ? (condition.conditions.map(findImpossible).find(Boolean) ?? null)
      : null;
  }
  const compares =
    condition.type === "compare"
      ? [condition]
      : condition.conditions.flatMap((c) => (c.type === "compare" ? [c] : []));
  const bounds = new Map<
    string,
    { lo: number; loIn: boolean; hi: number; hiIn: boolean; eq?: string }
  >();
  for (const c of compares) {
    const key =
      c.left.type === "answer"
        ? `a:${c.left.questionId}:${c.left.field ?? ""}`
        : c.left.type === "variable"
          ? `v:${c.left.variableId}`
          : null;
    if (!key || !c.right || c.right.type !== "literal") continue;
    const b = bounds.get(key) ?? { lo: -Infinity, loIn: true, hi: Infinity, hiIn: true };
    const value = c.right.value;
    if (c.op === "eq" && (typeof value === "string" || typeof value === "number")) {
      if (b.eq !== undefined && b.eq !== String(value)) {
        return "it can never be true: the same value can't equal two different things.";
      }
      b.eq = String(value);
    }
    if (typeof value === "number") {
      if (c.op === "gt" && value >= b.lo) Object.assign(b, { lo: value, loIn: false });
      if (c.op === "gte" && value > b.lo) Object.assign(b, { lo: value, loIn: true });
      if (c.op === "lt" && value <= b.hi) Object.assign(b, { hi: value, hiIn: false });
      if (c.op === "lte" && value < b.hi) Object.assign(b, { hi: value, hiIn: true });
      if (c.op === "eq")
        Object.assign(b, { lo: value, loIn: true, hi: value, hiIn: true });
      if (
        c.op === "between" &&
        c.right2?.type === "literal" &&
        typeof c.right2.value === "number"
      ) {
        if (value > b.lo) Object.assign(b, { lo: value, loIn: true });
        if (c.right2.value < b.hi) Object.assign(b, { hi: c.right2.value, hiIn: true });
      }
    }
    if (b.lo > b.hi || (b.lo === b.hi && !(b.loIn && b.hiIn))) {
      return "it can never be true: the limits contradict each other.";
    }
    bounds.set(key, b);
  }
  if (condition.type === "all") {
    return (
      condition.conditions
        .filter((c) => c.type !== "compare")
        .map(findImpossible)
        .find(Boolean) ?? null
    );
  }
  return null;
}

function checkAction(ctx: Ctx, rule: RuleV1, action: ActionV1, label: string) {
  const error = (code: string, message: string) =>
    ctx.issues.push({
      severity: "error",
      code,
      message: `${label}: ${message}`,
      ruleId: rule.id,
      questionId: rule.on.event === "question_answered" ? rule.on.questionId : undefined,
    });

  switch (action.type) {
    case "jump_to_question": {
      if (!ctx.questions.has(action.questionId)) {
        error("missing_target", "the question it jumps to was deleted. Pick another.");
      } else if (rule.on.event !== "question_answered") {
        error(
          "jump_not_allowed",
          "only a rule on a question can jump to another question.",
        );
      } else if (
        (ctx.position.get(action.questionId) ?? 0) <=
        (ctx.position.get(rule.on.questionId) ?? 0)
      ) {
        error(
          "backward_jump",
          "it jumps back to an earlier question, which could trap respondents in a loop. Jump to a later question or an ending.",
        );
      }
      break;
    }
    case "jump_to_ending":
      if (!ctx.endings.has(action.endingId)) {
        error("missing_target", "the ending it goes to was deleted. Pick another.");
      }
      break;
    case "go_to_highest":
      for (const c of action.candidates) {
        const variable = ctx.variables.get(c.variableId);
        if (!variable) error("missing_variable", "one of its scores doesn't exist.");
        else if (variable.type !== "number") {
          error(
            "wrong_type",
            `“${variable.name}” isn't a number, so it can't be compared.`,
          );
        }
        if (!ctx.endings.has(c.endingId)) {
          error("missing_target", "one of its endings was deleted.");
        }
      }
      break;
    case "set_variable": {
      const variable = ctx.variables.get(action.variableId);
      if (!variable) {
        error("missing_variable", "it changes a variable that doesn't exist.");
        break;
      }
      const numeric = ["subtract", "multiply", "divide"].includes(action.op);
      if (numeric && variable.type !== "number") {
        error(
          "wrong_type",
          `“${variable.name}” isn't a number, so it can't be ${action.op === "subtract" ? "subtracted from" : action.op === "multiply" ? "multiplied" : "divided"}.`,
        );
      }
      if (
        action.op === "add" &&
        variable.type !== "number" &&
        variable.type !== "string"
      ) {
        error("wrong_type", `can't add to “${variable.name}”.`);
      }
      if (
        (action.op === "append" || action.op === "remove") &&
        variable.type !== "list"
      ) {
        error("wrong_type", `“${variable.name}” isn't a list.`);
      }
      if (
        action.op === "divide" &&
        action.value.type === "literal" &&
        action.value.value === 0
      ) {
        error("division_by_zero", "it divides by zero.");
      }
      checkExpr(ctx, action.value, { label, ruleId: rule.id });
      break;
    }
  }
}

export function analyzeLogic(schema: FormSchemaV1): LogicIssue[] {
  const ordered = [...schema.questions].sort((a, b) => a.order - b.order);
  const ctx: Ctx = {
    schema,
    ordered,
    position: new Map(ordered.map((q, i) => [q.id, i])),
    questions: new Map(schema.questions.map((q) => [q.id, q])),
    variables: new Map((schema.variables ?? []).map((v) => [v.id, v])),
    hidden: new Set((schema.hiddenFields ?? []).map((h) => h.name)),
    endings: new Set(schema.endings.map((e) => e.id)),
    issues: [],
  };
  const push = (issue: LogicIssue) => ctx.issues.push(issue);

  // Names and ids.
  const names = new Set<string>();
  const variableIds = new Set<string>();
  for (const v of schema.variables ?? []) {
    if (variableIds.has(v.id)) {
      push({
        severity: "error",
        code: "duplicate_variable",
        message: "Two variables share the same id.",
      });
    }
    variableIds.add(v.id);
    if (names.has(v.name)) {
      push({
        severity: "error",
        code: "duplicate_name",
        message: `Two variables are called “${v.name}”.`,
      });
    }
    names.add(v.name);
  }
  for (const h of schema.hiddenFields ?? []) {
    if (names.has(h.name)) {
      push({
        severity: "error",
        code: "duplicate_name",
        message: `“${h.name}” is used for more than one variable or URL field.`,
      });
    }
    names.add(h.name);
  }
  const ruleIds = new Set(schema.logic.map((r) => r.id));
  for (const rule of schema.rules ?? []) {
    if (ruleIds.has(rule.id)) {
      push({
        severity: "error",
        code: "duplicate_rule",
        message: "Two logic rules share the same id.",
        ruleId: rule.id,
      });
    }
    ruleIds.add(rule.id);
  }

  // Rules.
  const unconditionalNav = new Map<string, string>();
  for (const rule of schema.rules ?? []) {
    if (rule.disabled) continue;
    const label = ruleLabel(ctx, rule);
    const triggerKey =
      rule.on.event === "question_answered" ? `q:${rule.on.questionId}` : rule.on.event;
    if (rule.on.event === "question_answered" && !ctx.questions.has(rule.on.questionId)) {
      push({
        severity: "error",
        code: "missing_question",
        message: `${label}: the question it runs on was deleted.`,
        ruleId: rule.id,
      });
    }
    if (rule.when) checkCondition(ctx, rule.when, { label, ruleId: rule.id });
    rule.then.forEach((a) => checkAction(ctx, rule, a, label));

    const navigates = rule.then.some((a) => NAVIGATION_ACTIONS.has(a.type));
    if (navigates) {
      const earlier = unconditionalNav.get(triggerKey);
      if (earlier) {
        push({
          severity: "warning",
          code: "shadowed_rule",
          message: `${label}: an earlier rule always decides where people go here, so this one's jump never runs.`,
          ruleId: rule.id,
        });
      } else if (!rule.when) {
        unconditionalNav.set(triggerKey, rule.id);
      }
    }
  }

  // Questions: visibility, checks, option scores.
  for (const q of ordered) {
    const label = `Question ${number(ctx, q.id)}`;
    if (q.visibleIf) {
      checkCondition(ctx, q.visibleIf, {
        label: `${label}'s show condition`,
        questionId: q.id,
      });
      for (const e of conditionExprs(q.visibleIf)) {
        if (e.type !== "answer") continue;
        if (e.questionId === q.id) {
          push({
            severity: "error",
            code: "self_reference",
            message: `${label}: it can't be shown based on its own answer.`,
            questionId: q.id,
          });
        } else if (
          (ctx.position.get(e.questionId) ?? -1) > (ctx.position.get(q.id) ?? 0)
        ) {
          push({
            severity: "warning",
            code: "later_answer",
            message: `${label}: it's shown based on question ${number(ctx, e.questionId)}, which comes later, so that answer is always empty here.`,
            questionId: q.id,
          });
        }
      }
      if (q.required) {
        push({
          severity: "warning",
          code: "required_conditional",
          message: `${label} is required but only shown sometimes; when it's hidden it's skipped, not required.`,
          questionId: q.id,
        });
      }
    }
    for (const check of q.validations ?? []) {
      const where = { label: `${label}'s check “${check.message}”`, questionId: q.id };
      if (check.when) checkCondition(ctx, check.when, where);
      checkCondition(ctx, check.check, where);
    }
    for (const option of (
      q.settings as { options?: { scores?: { variableId: string }[] }[] }
    ).options ?? []) {
      for (const score of option.scores ?? []) {
        const variable = ctx.variables.get(score.variableId);
        if (!variable || variable.type !== "number") {
          push({
            severity: "error",
            code: "missing_variable",
            message: `${label}: an option gives points to a score that doesn't exist.`,
            questionId: q.id,
          });
        }
      }
    }
  }

  return ctx.issues;
}
