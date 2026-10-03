import { z } from "zod";
import { safeText, stableId } from "./primitives";

/**
 * The logic engine's data model (docs/logic-engine.md). Everything here
 * is plain data — a typed AST the engine interprets — never code, so a
 * stored form (or an AI-suggested rule) can't execute anything.
 */

// --- values -----------------------------------------------------------------

/** A value as the engine sees it: answers, variables and literals all
 * reduce to one of these. Dates are ISO `YYYY-MM-DD` strings. */
export type Value = string | number | boolean | null | (string | number)[];

export const LiteralValue = z.union([
  safeText(1000),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(z.union([safeText(500), z.number().finite()])).max(200),
]);

// --- expressions ------------------------------------------------------------

export const BINARY_OPERATORS = ["+", "-", "*", "/", "%"] as const;
export type BinaryOperator = (typeof BINARY_OPERATORS)[number];

/** Whitelisted functions. Anything else is rejected by the schema. */
export const EXPRESSION_FUNCTIONS = [
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "COUNT",
  "ROUND",
  "CEIL",
  "FLOOR",
  "ABS",
  "PERCENTAGE",
  "LENGTH",
  "TODAY",
  "DAYS_BETWEEN",
  "AGE",
] as const;
export type ExpressionFunction = (typeof EXPRESSION_FUNCTIONS)[number];

export type Expr =
  | { type: "literal"; value: Value }
  | { type: "answer"; questionId: string; field?: string }
  | { type: "variable"; variableId: string }
  | { type: "hidden"; name: string }
  | { type: "binary"; op: BinaryOperator; left: Expr; right: Expr }
  | { type: "call"; fn: ExpressionFunction; args: Expr[] };

export const Expr: z.ZodType<Expr> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("literal"), value: LiteralValue }),
    z.object({
      type: z.literal("answer"),
      questionId: stableId,
      field: z.string().max(40).optional(),
    }),
    z.object({ type: z.literal("variable"), variableId: stableId }),
    z.object({ type: z.literal("hidden"), name: z.string().max(40) }),
    z.object({
      type: z.literal("binary"),
      op: z.enum(BINARY_OPERATORS),
      left: Expr,
      right: Expr,
    }),
    z.object({
      type: z.literal("call"),
      fn: z.enum(EXPRESSION_FUNCTIONS),
      args: z.array(Expr).max(20),
    }),
  ]),
);

// --- conditions -------------------------------------------------------------

export const COMPARE_OPERATORS = [
  // equality
  "eq",
  "neq",
  // numbers (and dates, which compare as ISO strings)
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "not_between",
  // text and selections
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "is_empty",
  "is_not_empty",
  "any_of",
  "all_of",
  "none_of",
  // dates
  "before",
  "after",
  "on",
  "is_today",
  "is_this_week",
  "is_this_month",
  "is_weekday",
  "is_weekend",
  // booleans
  "is_true",
  "is_false",
] as const;
export type CompareOperator = (typeof COMPARE_OPERATORS)[number];

/** Operators that look only at the left side. */
export const UNARY_COMPARE_OPERATORS = new Set<CompareOperator>([
  "is_empty",
  "is_not_empty",
  "is_today",
  "is_this_week",
  "is_this_month",
  "is_weekday",
  "is_weekend",
  "is_true",
  "is_false",
]);

/** Operators that need a second right-hand value (a range). */
export const RANGE_COMPARE_OPERATORS = new Set<CompareOperator>([
  "between",
  "not_between",
]);

export type Condition =
  | { type: "all"; conditions: Condition[] }
  | { type: "any"; conditions: Condition[] }
  | { type: "not"; condition: Condition }
  | { type: "compare"; left: Expr; op: CompareOperator; right?: Expr; right2?: Expr };

export const Condition: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("all"), conditions: z.array(Condition).max(30) }),
    z.object({ type: z.literal("any"), conditions: z.array(Condition).max(30) }),
    z.object({ type: z.literal("not"), condition: Condition }),
    z.object({
      type: z.literal("compare"),
      left: Expr,
      op: z.enum(COMPARE_OPERATORS),
      right: Expr.optional(),
      right2: Expr.optional(),
    }),
  ]),
);

// --- variables --------------------------------------------------------------

export const VARIABLE_TYPES = ["number", "string", "boolean", "date", "list"] as const;
export type VariableType = (typeof VARIABLE_TYPES)[number];

/** Used in recall as `{{name}}`, so it's a lowercase identifier. */
export const variableName = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]{0,39}$/,
    "names start with a letter and use lowercase letters, numbers and _",
  );

export const VariableV1 = z.object({
  id: stableId,
  name: variableName,
  type: z.enum(VARIABLE_TYPES),
  initial: LiteralValue.optional(),
  /** Shown in the builder only. */
  description: safeText(300).optional(),
});
export type VariableV1 = z.infer<typeof VariableV1>;

/** A value read from the form's URL (`?source=linkedin`). Client-provided:
 * fine for personalising and routing, never for anything trusted. */
export const HiddenFieldV1 = z.object({
  name: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,39}$/, "use lowercase letters, numbers and _"),
  default: safeText(500).optional(),
});
export type HiddenFieldV1 = z.infer<typeof HiddenFieldV1>;

// --- actions ----------------------------------------------------------------

export const VARIABLE_OPERATIONS = [
  "set",
  "add",
  "subtract",
  "multiply",
  "divide",
  "append",
  "remove",
] as const;
export type VariableOperation = (typeof VARIABLE_OPERATIONS)[number];

export const ActionV1 = z.discriminatedUnion("type", [
  z.object({ type: z.literal("jump_to_question"), questionId: stableId }),
  z.object({ type: z.literal("jump_to_ending"), endingId: stableId }),
  z.object({
    type: z.literal("set_variable"),
    variableId: stableId,
    op: z.enum(VARIABLE_OPERATIONS),
    value: Expr,
  }),
  /** Outcome quizzes: go to the ending paired with the highest variable.
   * Ties go to the earliest candidate (list order = priority). */
  z.object({
    type: z.literal("go_to_highest"),
    candidates: z
      .array(z.object({ variableId: stableId, endingId: stableId }))
      .min(1)
      .max(20),
  }),
]);
export type ActionV1 = z.infer<typeof ActionV1>;

export const NAVIGATION_ACTIONS = new Set<ActionV1["type"]>([
  "jump_to_question",
  "jump_to_ending",
  "go_to_highest",
]);

// --- rules ------------------------------------------------------------------

export const RuleTriggerV1 = z.discriminatedUnion("event", [
  z.object({ event: z.literal("form_started") }),
  z.object({ event: z.literal("question_answered"), questionId: stableId }),
  z.object({ event: z.literal("form_completed") }),
]);
export type RuleTriggerV1 = z.infer<typeof RuleTriggerV1>;

export const RuleV1 = z.object({
  id: stableId,
  name: safeText(120).optional(),
  on: RuleTriggerV1,
  /** No condition = always. */
  when: Condition.optional(),
  then: z.array(ActionV1).min(1).max(20),
  disabled: z.boolean().optional(),
});
export type RuleV1 = z.infer<typeof RuleV1>;

// --- question extras --------------------------------------------------------

/** Conditional / cross-field validation: when `when` holds (or always),
 * `check` must hold, else `message` is shown. */
export const QuestionValidationV1 = z.object({
  id: stableId,
  when: Condition.optional(),
  check: Condition,
  message: safeText(200),
});
export type QuestionValidationV1 = z.infer<typeof QuestionValidationV1>;

/** Points an option adds to a variable when chosen (quizzes, scoring). */
export const OptionScoreV1 = z.object({
  variableId: stableId,
  points: z.number().finite().min(-100000).max(100000),
});
export type OptionScoreV1 = z.infer<typeof OptionScoreV1>;

// --- question pools ---------------------------------------------------------

/** Each respondent is asked `pick` of these questions, chosen at random
 * but fixed for the response (seeded), so the browser and the server
 * agree on which were asked. Unpicked ones are skipped like hidden ones. */
export const QuestionPoolV1 = z.object({
  id: stableId,
  name: safeText(80).optional(),
  questionIds: z.array(stableId).min(2).max(50),
  pick: z.number().int().min(1).max(49),
  /** Adaptive assessment (phase 20): instead of a random draw, ask one
   * at a time by difficulty (1–5) — harder after a right answer, easier
   * after a wrong one. Questions without a level count as 3. */
  adaptive: z
    .object({
      start: z.number().int().min(1).max(5),
      levels: z.record(stableId, z.number().int().min(1).max(5)),
    })
    .optional(),
});
export type QuestionPoolV1 = z.infer<typeof QuestionPoolV1>;
