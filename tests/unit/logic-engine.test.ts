import { describe, expect, it } from "vitest";
import { compileFormSchema, parseFormSchema } from "@/domains/forms/schema";
import type { Condition, Expr, Value } from "@/domains/forms/schema/logic-model";
import type { z } from "zod";
import type { FormSchemaV1, QuestionV1 } from "@/domains/forms/schema/v1";

type FormInput = z.input<typeof FormSchemaV1>;
import {
  evaluateCondition,
  evaluateExpr,
  firstQuestionId,
  nextStepFor,
  questionLogicError,
  todayIn,
  walkForm,
  type ExprContext,
} from "@/domains/logic";

// --- helpers ---------------------------------------------------------------------

const lit = (value: Value): Expr => ({ type: "literal", value });
const ans = (questionId: string, field?: string): Expr => ({
  type: "answer",
  questionId,
  field,
});
const v = (variableId: string): Expr => ({ type: "variable", variableId });
const cmp = (
  left: Expr,
  op: Extract<Condition, { type: "compare" }>["op"],
  right?: Expr,
  right2?: Expr,
): Condition => ({ type: "compare", left, op, right, right2 });

function ctx(partial: Partial<ExprContext> = {}): ExprContext {
  return { answers: {}, variables: {}, hidden: {}, today: "2026-10-02", ...partial };
}

const text = (id: string, order: number, extra: Partial<QuestionV1> = {}): QuestionV1 =>
  ({
    id,
    type: "short_text",
    order,
    label: id,
    required: false,
    settings: {},
    ...extra,
  }) as QuestionV1;

const choice = (
  id: string,
  order: number,
  options: { id: string; scores?: { variableId: string; points: number }[] }[],
  extra: Partial<QuestionV1> = {},
): QuestionV1 =>
  ({
    id,
    type: "single_select",
    order,
    label: id,
    required: false,
    settings: { options: options.map((o) => ({ label: o.id, ...o })), allowOther: false },
    ...extra,
  }) as QuestionV1;

function form(overrides: Partial<FormInput>) {
  const schema = parseFormSchema({
    schemaVersion: 1,
    meta: { title: "t" },
    theme: {},
    endings: [{ id: "end", title: "Thanks", isDefault: true }],
    questions: [text("q1", 0)],
    logic: [],
    ...overrides,
  });
  return compileFormSchema(schema);
}

// --- expressions -------------------------------------------------------------------

describe("expressions", () => {
  const e = (expr: Expr, c = ctx()) => evaluateExpr(expr, c);
  const bin = (op: "+" | "-" | "*" | "/" | "%", a: Value, b: Value): Expr => ({
    type: "binary",
    op,
    left: lit(a),
    right: lit(b),
  });
  const call = (fn: Extract<Expr, { type: "call" }>["fn"], ...args: Value[]): Expr => ({
    type: "call",
    fn,
    args: args.map(lit),
  });

  it("does arithmetic and never returns NaN or Infinity", () => {
    expect(e(bin("+", 2, 3))).toBe(5);
    expect(e(bin("*", 4, 2.5))).toBe(10);
    expect(e(bin("%", 7, 3))).toBe(1);
    expect(e(bin("/", 1, 0))).toBeNull();
    expect(e(bin("%", 1, 0))).toBeNull();
    expect(e(bin("*", 1e308, 10))).toBeNull();
  });

  it("joins text and lets null flow through arithmetic", () => {
    expect(e(bin("+", "Hi ", "Ada"))).toBe("Hi Ada");
    expect(e(bin("+", null, 1))).toBeNull();
    expect(e(bin("-", "abc", 1))).toBeNull();
  });

  it("reads answers, contact fields, variables and hidden fields", () => {
    const c = ctx({
      answers: { qty: 3, contact: { name: "Ada", email: "a@b.co" } },
      variables: { price: 10 },
      hidden: { source: "linkedin" },
    });
    expect(e({ type: "binary", op: "*", left: ans("qty"), right: v("price") }, c)).toBe(
      30,
    );
    expect(e(ans("contact", "email"), c)).toBe("a@b.co");
    expect(e({ type: "hidden", name: "source" }, c)).toBe("linkedin");
    expect(e(ans("missing"), c)).toBeNull();
  });

  it("has safe aggregate and rounding functions", () => {
    expect(e(call("SUM", 1, 2, null, [3, 4]))).toBe(10);
    expect(e(call("AVG", 2, 4))).toBe(3);
    expect(e(call("AVG"))).toBeNull();
    expect(e(call("MIN", 5, 2, 9))).toBe(2);
    expect(e(call("MAX", 5, 2, 9))).toBe(9);
    expect(e(call("COUNT", "a", "", null, ["x", "y"]))).toBe(3);
    expect(e(call("ROUND", 3.14159, 2))).toBe(3.14);
    expect(e(call("CEIL", 1.2))).toBe(2);
    expect(e(call("FLOOR", 1.8))).toBe(1);
    expect(e(call("ABS", -4))).toBe(4);
    expect(e(call("PERCENTAGE", 3, 4))).toBe(75);
    expect(e(call("PERCENTAGE", 3, 0))).toBeNull();
    expect(e(call("LENGTH", "hello"))).toBe(5);
  });

  it("does date maths against a pinned today", () => {
    expect(e(call("TODAY"))).toBe("2026-10-02");
    expect(e(call("DAYS_BETWEEN", "2026-10-01", "2026-10-11"))).toBe(10);
    expect(e(call("DAYS_BETWEEN", "2026-02-31", "2026-03-01"))).toBeNull();
    expect(e(call("AGE", "2000-10-03"))).toBe(25);
    expect(e(call("AGE", "2000-10-02"))).toBe(26);
  });

  it("works out today in the form's timezone", () => {
    const instant = new Date("2026-10-02T23:30:00Z");
    expect(todayIn(instant, "UTC")).toBe("2026-10-02");
    expect(todayIn(instant, "Asia/Kolkata")).toBe("2026-10-03");
    expect(todayIn(instant, "Not/AZone")).toBe("2026-10-02");
  });
});

// --- conditions ----------------------------------------------------------------------

describe("conditions", () => {
  const check = (c: Condition, context = ctx()) => evaluateCondition(c, context);
  const cases: [string, Condition, boolean][] = [
    ["eq", cmp(lit("a"), "eq", lit("a")), true],
    ["eq is strict on type", cmp(lit(5), "eq", lit("5")), false],
    ["neq", cmp(lit("a"), "neq", lit("b")), true],
    ["gt", cmp(lit(5), "gt", lit(3)), true],
    ["gte", cmp(lit(3), "gte", lit(3)), true],
    ["lt", cmp(lit(2), "lt", lit(3)), true],
    ["lte", cmp(lit(4), "lte", lit(3)), false],
    ["between (inclusive)", cmp(lit(5), "between", lit(1), lit(5)), true],
    ["not_between", cmp(lit(6), "not_between", lit(1), lit(5)), true],
    ["contains text, any case", cmp(lit("Hello World"), "contains", lit("world")), true],
    ["contains a selected option", cmp(lit(["a", "b"]), "contains", lit("b")), true],
    ["not_contains", cmp(lit(["a"]), "not_contains", lit("b")), true],
    ["starts_with", cmp(lit("FormCraft"), "starts_with", lit("form")), true],
    ["ends_with", cmp(lit("FormCraft"), "ends_with", lit("CRAFT")), true],
    ["is_empty on blank text", cmp(lit("  "), "is_empty"), true],
    ["is_empty on empty list", cmp(lit([]), "is_empty"), true],
    ["is_not_empty", cmp(lit("x"), "is_not_empty"), true],
    ["any_of", cmp(lit("b"), "any_of", lit(["a", "b"])), true],
    ["any_of on a list", cmp(lit(["x", "b"]), "any_of", lit(["a", "b"])), true],
    ["all_of", cmp(lit(["a", "b", "c"]), "all_of", lit(["a", "b"])), true],
    ["all_of missing one", cmp(lit(["a"]), "all_of", lit(["a", "b"])), false],
    ["none_of", cmp(lit(["x"]), "none_of", lit(["a", "b"])), true],
    ["before", cmp(lit("2026-01-01"), "before", lit("2026-02-01")), true],
    ["after", cmp(lit("2026-03-01"), "after", lit("2026-02-01")), true],
    ["on", cmp(lit("2026-03-01"), "on", lit("2026-03-01")), true],
    ["is_today", cmp(lit("2026-10-02"), "is_today"), true],
    ["is_this_week (Mon 28 Sep)", cmp(lit("2026-09-28"), "is_this_week"), true],
    ["is_this_week (Sun 27 Sep)", cmp(lit("2026-09-27"), "is_this_week"), false],
    ["is_this_month", cmp(lit("2026-10-31"), "is_this_month"), true],
    ["is_weekday (Fri)", cmp(lit("2026-10-02"), "is_weekday"), true],
    ["is_weekend (Sat)", cmp(lit("2026-10-03"), "is_weekend"), true],
    ["is_true", cmp(lit(true), "is_true"), true],
    ["is_false", cmp(lit(false), "is_false"), true],
    ["comparing with nothing is false", cmp(lit(null), "gt", lit(1)), false],
    ["comparing text to a number is false", cmp(lit("abc"), "lt", lit(1)), false],
  ];
  it.each(cases)("%s", (_name, condition, expected) => {
    expect(check(condition)).toBe(expected);
  });

  it("compares two answers (cross-field)", () => {
    const c = ctx({
      answers: { start: "2026-01-10", end: "2026-01-05", min: 10, max: 20 },
    });
    expect(check(cmp(ans("end"), "gte", ans("start")), c)).toBe(false);
    expect(check(cmp(ans("min"), "lte", ans("max")), c)).toBe(true);
  });

  it("combines with all / any / not", () => {
    const c = ctx({ answers: { country: "India", age: 20, role: "Student" } });
    const india = cmp(ans("country"), "eq", lit("India"));
    const adult = cmp(ans("age"), "gte", lit(18));
    const usa = cmp(ans("country"), "eq", lit("USA"));
    expect(check({ type: "all", conditions: [india, adult] }, c)).toBe(true);
    expect(check({ type: "any", conditions: [usa, india] }, c)).toBe(true);
    expect(check({ type: "not", condition: usa }, c)).toBe(true);
    expect(check({ type: "all", conditions: [] }, c)).toBe(true);
    expect(check({ type: "any", conditions: [] }, c)).toBe(false);
  });
});

// --- the engine ---------------------------------------------------------------------------

describe("variables and calculations", () => {
  it("applies set / add / subtract / multiply / divide in order", () => {
    const compiled = form({
      variables: [{ id: "total", name: "total", type: "number" }],
      rules: [
        {
          id: "r1",
          on: { event: "question_answered", questionId: "q1" },
          then: [
            { type: "set_variable", variableId: "total", op: "set", value: lit(10) },
            { type: "set_variable", variableId: "total", op: "add", value: lit(5) },
            { type: "set_variable", variableId: "total", op: "multiply", value: lit(2) },
            { type: "set_variable", variableId: "total", op: "subtract", value: lit(6) },
            { type: "set_variable", variableId: "total", op: "divide", value: lit(4) },
            { type: "set_variable", variableId: "total", op: "divide", value: lit(0) },
          ],
        },
      ],
    });
    const result = walkForm(compiled, { q1: "x" });
    expect(result.variables.total).toBe(6);
    expect(result.trace.some((t) => t.kind === "warning" && /zero/.test(t.message))).toBe(
      true,
    );
  });

  it("computes total = quantity × price from answers", () => {
    const compiled = form({
      questions: [
        {
          id: "qty",
          type: "number",
          order: 0,
          label: "Qty",
          required: true,
          settings: {},
        },
      ],
      variables: [
        { id: "price", name: "price", type: "number", initial: 250 },
        { id: "total", name: "total", type: "number" },
      ],
      rules: [
        {
          id: "calc",
          on: { event: "form_completed" },
          then: [
            {
              type: "set_variable",
              variableId: "total",
              op: "set",
              value: { type: "binary", op: "*", left: ans("qty"), right: v("price") },
            },
          ],
        },
      ],
    });
    expect(walkForm(compiled, { qty: 4 }).variables.total).toBe(1000);
  });

  it("refuses a value that doesn't fit the variable's type, and says so", () => {
    const compiled = form({
      variables: [{ id: "n", name: "n", type: "number", initial: 1 }],
      rules: [
        {
          id: "r",
          on: { event: "question_answered", questionId: "q1" },
          then: [{ type: "set_variable", variableId: "n", op: "set", value: ans("q1") }],
        },
      ],
    });
    const result = walkForm(compiled, { q1: "not a number" });
    expect(result.variables.n).toBe(1);
    expect(result.trace.some((t) => t.kind === "warning")).toBe(true);
  });

  it("appends to and removes from a list", () => {
    const compiled = form({
      variables: [{ id: "tags", name: "tags", type: "list" }],
      rules: [
        {
          id: "r",
          on: { event: "question_answered", questionId: "q1" },
          then: [
            {
              type: "set_variable",
              variableId: "tags",
              op: "append",
              value: lit(["a", "b"]),
            },
            { type: "set_variable", variableId: "tags", op: "remove", value: lit("a") },
          ],
        },
      ],
    });
    expect(walkForm(compiled, { q1: "x" }).variables.tags).toEqual(["b"]);
  });

  it("is derived from the answers: changing an answer changes the result", () => {
    const compiled = form({
      questions: [
        choice("q1", 0, [
          { id: "a", scores: [{ variableId: "s", points: 5 }] },
          { id: "b" },
        ]),
      ],
      variables: [{ id: "s", name: "score", type: "number" }],
    });
    expect(walkForm(compiled, { q1: "a" }).variables.s).toBe(5);
    expect(walkForm(compiled, { q1: "b" }).variables.s).toBe(0);
  });
});

describe("scoring and outcomes", () => {
  const quiz = () =>
    form({
      questions: [
        choice(
          "q1",
          0,
          [
            { id: "tech", scores: [{ variableId: "technical", points: 10 }] },
            {
              id: "art",
              scores: [
                { variableId: "creative", points: 10 },
                { variableId: "technical", points: -5 },
              ],
            },
          ],
          { weight: 2 } as Partial<QuestionV1>,
        ),
        choice("q2", 1, [
          { id: "biz", scores: [{ variableId: "business", points: 15 }] },
          { id: "art2", scores: [{ variableId: "creative", points: 5 }] },
        ]),
      ],
      variables: [
        { id: "technical", name: "technical", type: "number" },
        { id: "creative", name: "creative", type: "number" },
        { id: "business", name: "business", type: "number" },
      ],
      endings: [
        { id: "end", title: "Default", isDefault: true },
        { id: "e_tech", title: "Technical" },
        { id: "e_creative", title: "Creative" },
        { id: "e_business", title: "Business" },
      ],
      rules: [
        {
          id: "outcome",
          on: { event: "form_completed" },
          then: [
            {
              type: "go_to_highest",
              candidates: [
                { variableId: "technical", endingId: "e_tech" },
                { variableId: "creative", endingId: "e_creative" },
                { variableId: "business", endingId: "e_business" },
              ],
            },
          ],
        },
      ],
    });

  it("adds weighted, positive and negative points", () => {
    const result = walkForm(quiz(), { q1: "art", q2: "art2" });
    expect(result.variables).toMatchObject({ technical: -10, creative: 25, business: 0 });
    expect(result.endingId).toBe("e_creative");
  });

  it("breaks ties by candidate order", () => {
    // technical 20 vs business 15 → technical; then force a tie.
    expect(walkForm(quiz(), { q1: "tech", q2: "biz" }).endingId).toBe("e_tech");
    const tie = walkForm(quiz(), {}); // everything 0 → first candidate
    expect(tie.endingId).toBe("e_tech");
  });

  it("maps a score to a band and an ending by threshold", () => {
    const compiled = form({
      questions: [
        {
          id: "n",
          type: "number",
          order: 0,
          label: "Score",
          required: true,
          settings: {},
        },
      ],
      variables: [
        { id: "score", name: "score", type: "number" },
        { id: "band", name: "band", type: "string" },
      ],
      endings: [
        { id: "end", title: "Keep going", isDefault: true },
        { id: "great", title: "Excellent" },
      ],
      rules: [
        {
          id: "copy",
          on: { event: "question_answered", questionId: "n" },
          then: [
            { type: "set_variable", variableId: "score", op: "set", value: ans("n") },
          ],
        },
        {
          id: "band_good",
          on: { event: "form_completed" },
          when: cmp(v("score"), "between", lit(60), lit(79)),
          then: [
            { type: "set_variable", variableId: "band", op: "set", value: lit("Good") },
          ],
        },
        {
          id: "band_top",
          on: { event: "form_completed" },
          when: cmp(v("score"), "gte", lit(80)),
          then: [
            {
              type: "set_variable",
              variableId: "band",
              op: "set",
              value: lit("Excellent"),
            },
            { type: "jump_to_ending", endingId: "great" },
          ],
        },
      ],
    });
    expect(walkForm(compiled, { n: 65 })).toMatchObject({
      endingId: "end",
      variables: { band: "Good" },
    });
    expect(walkForm(compiled, { n: 92 })).toMatchObject({
      endingId: "great",
      variables: { band: "Excellent" },
    });
  });
});

describe("navigation", () => {
  const branching = () =>
    form({
      questions: [
        choice("role", 0, [{ id: "student" }, { id: "pro" }]),
        text("s1", 1),
        text("s2", 2),
        text("p1", 3),
      ],
      endings: [
        { id: "end", title: "Thanks", isDefault: true },
        { id: "no", title: "Not eligible" },
      ],
      rules: [
        {
          id: "to_pro",
          on: { event: "question_answered", questionId: "role" },
          when: cmp(ans("role"), "eq", lit("pro")),
          then: [{ type: "jump_to_question", questionId: "p1" }],
        },
        {
          id: "student_done",
          on: { event: "question_answered", questionId: "s2" },
          then: [{ type: "jump_to_ending", endingId: "end" }],
        },
      ],
    });

  it("takes the path the answers choose, and reports it", () => {
    expect(walkForm(branching(), { role: "student" }).visitedQuestionIds).toEqual([
      "role",
      "s1",
      "s2",
    ]);
    const pro = walkForm(branching(), { role: "pro" });
    expect(pro.visitedQuestionIds).toEqual(["role", "p1"]);
    expect(pro.trace).toContainEqual({ kind: "rule_matched", ruleId: "to_pro" });
  });

  it("gives the first matching navigation priority, but runs every match's variables", () => {
    const compiled = form({
      questions: [text("q1", 0), text("q2", 1), text("q3", 2)],
      variables: [{ id: "hits", name: "hits", type: "number" }],
      rules: [
        {
          id: "a",
          on: { event: "question_answered", questionId: "q1" },
          then: [
            { type: "set_variable", variableId: "hits", op: "add", value: lit(1) },
            { type: "jump_to_question", questionId: "q3" },
          ],
        },
        {
          id: "b",
          on: { event: "question_answered", questionId: "q1" },
          then: [
            { type: "set_variable", variableId: "hits", op: "add", value: lit(1) },
            { type: "jump_to_question", questionId: "q2" },
          ],
        },
      ],
    });
    const result = walkForm(compiled, { q1: "x" });
    expect(result.visitedQuestionIds).toEqual(["q1", "q3"]);
    expect(result.variables.hits).toBe(2);
  });

  it("keeps an ending a question rule chose, even if a completion rule disagrees", () => {
    const compiled = form({
      questions: [text("q1", 0)],
      endings: [
        { id: "end", title: "Default", isDefault: true },
        { id: "a", title: "A" },
        { id: "b", title: "B" },
      ],
      rules: [
        {
          id: "q",
          on: { event: "question_answered", questionId: "q1" },
          then: [{ type: "jump_to_ending", endingId: "a" }],
        },
        {
          id: "c",
          on: { event: "form_completed" },
          then: [{ type: "jump_to_ending", endingId: "b" }],
        },
      ],
    });
    expect(walkForm(compiled, { q1: "x" }).endingId).toBe("a");
  });

  it("agrees step by step with the full walk", () => {
    const compiled = branching();
    const answers = { role: "student", s1: "a", s2: "b" };
    const walk = walkForm(compiled, answers);
    const path: string[] = [];
    let current: string | null = firstQuestionId(compiled, answers);
    while (current) {
      path.push(current);
      const { next } = nextStepFor(compiled, answers, path);
      if (next.type === "ending") {
        expect(next.endingId).toBe(walk.endingId);
        break;
      }
      current = next.questionId;
    }
    expect(path).toEqual(walk.visitedQuestionIds);
  });
});

describe("visibility", () => {
  const conditional = () =>
    form({
      questions: [
        choice("employed", 0, [{ id: "yes" }, { id: "no" }]),
        text("employer", 1, {
          required: true,
          visibleIf: cmp(ans("employed"), "eq", lit("yes")),
        } as Partial<QuestionV1>),
        text("last", 2),
      ],
    });

  it("skips a hidden question, so it's never on the path or required", () => {
    const result = walkForm(conditional(), { employed: "no" });
    expect(result.visitedQuestionIds).toEqual(["employed", "last"]);
    expect(result.trace).toContainEqual({
      kind: "question_skipped",
      questionId: "employer",
    });
  });

  it("shows it when its condition holds", () => {
    expect(walkForm(conditional(), { employed: "yes" }).visitedQuestionIds).toEqual([
      "employed",
      "employer",
      "last",
    ]);
  });

  it("lands on the next visible question when a jump targets a hidden one", () => {
    const compiled = form({
      questions: [
        text("q1", 0),
        text("q2", 1),
        text("hidden", 2, {
          visibleIf: cmp(lit(1), "eq", lit(2)),
        } as Partial<QuestionV1>),
        text("q4", 3),
      ],
      rules: [
        {
          id: "j",
          on: { event: "question_answered", questionId: "q1" },
          then: [{ type: "jump_to_question", questionId: "hidden" }],
        },
      ],
    });
    expect(walkForm(compiled, { q1: "x" }).visitedQuestionIds).toEqual(["q1", "q4"]);
  });

  it("skips a hidden first question", () => {
    const compiled = form({
      questions: [
        text("intro", 0, {
          visibleIf: cmp({ type: "hidden", name: "vip" }, "eq", lit("yes")),
        } as Partial<QuestionV1>),
        text("q2", 1),
      ],
      hiddenFields: [{ name: "vip" }],
    });
    expect(firstQuestionId(compiled)).toBe("q2");
    expect(firstQuestionId(compiled, {}, { hidden: { vip: "yes" } })).toBe("intro");
  });
});

describe("validation", () => {
  const withChecks = () =>
    form({
      questions: [
        text("country", 0),
        text("pin", 1, {
          validations: [
            {
              id: "pin6",
              when: cmp(ans("country"), "eq", lit("India")),
              check: cmp(
                { type: "call", fn: "LENGTH", args: [ans("pin")] },
                "eq",
                lit(6),
              ),
              message: "PIN codes in India have 6 digits.",
            },
          ],
        } as Partial<QuestionV1>),
        text("email", 2),
        text("confirm", 3, {
          validations: [
            {
              id: "same",
              check: cmp(ans("confirm"), "eq", ans("email")),
              message: "The emails don't match.",
            },
          ],
        } as Partial<QuestionV1>),
      ],
    });

  it("applies a check only when its condition holds", () => {
    expect(
      questionLogicError(withChecks(), { country: "India", pin: "123" }, [
        "country",
        "pin",
      ]),
    ).toBe("PIN codes in India have 6 digits.");
    expect(
      questionLogicError(withChecks(), { country: "UK", pin: "123" }, ["country", "pin"]),
    ).toBeNull();
  });

  it("compares fields, and the server walk reports failures on the path", () => {
    const result = walkForm(withChecks(), {
      country: "UK",
      pin: "x",
      email: "a@b.co",
      confirm: "a@c.co",
    });
    expect(result.validationErrors).toEqual([
      { questionId: "confirm", message: "The emails don't match." },
    ]);
  });

  it("doesn't validate a question that's hidden", () => {
    const compiled = form({
      questions: [
        text("q1", 0),
        text("q2", 1, {
          visibleIf: cmp(ans("q1"), "eq", lit("show")),
          validations: [
            { id: "x", check: cmp(ans("q2"), "is_not_empty"), message: "Needed" },
          ],
        } as Partial<QuestionV1>),
      ],
    });
    expect(walkForm(compiled, { q1: "hide" }).validationErrors).toEqual([]);
    expect(walkForm(compiled, { q1: "show" }).validationErrors).toHaveLength(1);
  });
});

describe("hidden fields and start rules", () => {
  it("reads declared URL values (with defaults) and ignores the rest", () => {
    const compiled = form({
      hiddenFields: [{ name: "source" }, { name: "plan", default: "free" }],
      variables: [{ id: "seg", name: "segment", type: "string" }],
      rules: [
        {
          id: "start",
          on: { event: "form_started" },
          when: cmp({ type: "hidden", name: "plan" }, "eq", lit("pro")),
          then: [
            { type: "set_variable", variableId: "seg", op: "set", value: lit("paid") },
          ],
        },
      ],
    });
    expect(
      walkForm(compiled, {}, { hidden: { plan: "pro", evil: "x" } }).variables.seg,
    ).toBe("paid");
    expect(walkForm(compiled, {}).variables.seg).toBe("");
  });

  it("is deterministic for the same inputs and clock", () => {
    const compiled = form({
      questions: [
        { id: "d", type: "date", order: 0, label: "d", required: false, settings: {} },
      ],
      variables: [{ id: "days", name: "days", type: "number" }],
      rules: [
        {
          id: "r",
          on: { event: "question_answered", questionId: "d" },
          then: [
            {
              type: "set_variable",
              variableId: "days",
              op: "set",
              value: {
                type: "call",
                fn: "DAYS_BETWEEN",
                args: [{ type: "call", fn: "TODAY", args: [] }, ans("d")],
              },
            },
          ],
        },
      ],
    });
    const now = new Date("2026-10-02T12:00:00Z");
    const a = walkForm(compiled, { d: "2026-10-12" }, { now });
    const b = walkForm(compiled, { d: "2026-10-12" }, { now });
    expect(a).toEqual(b);
    expect(a.variables.days).toBe(10);
  });
});
