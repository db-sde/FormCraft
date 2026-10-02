import { describe, expect, it } from "vitest";
import { parseFormSchema } from "@/domains/forms/schema";
import { evaluateExpr, parseFormula, printFormula } from "@/domains/logic";

const schema = parseFormSchema({
  schemaVersion: 1,
  meta: { title: "t" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    { id: "w", type: "welcome_screen", order: 0, label: "Hi", settings: {} },
    { id: "q_qty", type: "number", order: 1, label: "Qty", settings: {} },
    {
      id: "q_you",
      type: "contact_info",
      order: 2,
      label: "You",
      settings: { fields: ["name"], requiredFields: [] },
    },
  ],
  logic: [],
  variables: [{ id: "v_price", name: "price", type: "number", initial: 25 }],
  hiddenFields: [{ name: "coupon" }],
});

const ctx = {
  answers: { q_qty: 4, q_you: { name: "Ada" } },
  variables: { v_price: 25 },
  hidden: { coupon: "x" },
  today: "2026-10-02",
};

function evalText(text: string) {
  const parsed = parseFormula(text, schema);
  if (!parsed.ok) throw new Error(parsed.message);
  return evaluateExpr(parsed.expr, ctx);
}

describe("formulas", () => {
  it("respects precedence and brackets", () => {
    expect(evalText("q1 * price + 10")).toBe(110);
    expect(evalText("q1 * (price + 10)")).toBe(140);
    expect(evalText("-q1 + 1")).toBe(-3);
    expect(evalText("10 % 4")).toBe(2);
  });

  it("calls functions, reads fields and URL values, joins text", () => {
    expect(evalText("ROUND(price / 3, 1)")).toBe(8.3);
    expect(evalText('"Hi " + q2.name')).toBe("Hi Ada");
    expect(evalText("coupon")).toBe("x");
    expect(evalText("max(1, 5, 3)")).toBe(5);
  });

  it("stores questions by id, so reordering keeps the meaning", () => {
    const parsed = parseFormula("q1 * 2", schema);
    expect(parsed).toMatchObject({
      ok: true,
      expr: { left: { type: "answer", questionId: "q_qty" } },
    });
  });

  it("explains mistakes instead of throwing", () => {
    expect(parseFormula("q9 + 1", schema)).toEqual({
      ok: false,
      message: "There's no question 9.",
    });
    expect(parseFormula("total + 1", schema)).toMatchObject({ ok: false });
    expect(parseFormula("EVAL(1)", schema)).toMatchObject({ ok: false });
    expect(parseFormula("(1 + 2", schema)).toMatchObject({ ok: false });
    expect(parseFormula("1 +", schema)).toMatchObject({ ok: false });
    expect(parseFormula("1 2", schema)).toMatchObject({ ok: false });
    expect(parseFormula("alert`1`", schema)).toMatchObject({ ok: false });
    expect(parseFormula("", schema)).toMatchObject({ ok: false });
  });

  it("prints back what it parsed", () => {
    for (const text of [
      "q1 * price + 10",
      "q1 * (price + 10)",
      "ROUND(price / 3, 1)",
      '"Hi " + q2.name',
      "-q1 + 1",
    ]) {
      const parsed = parseFormula(text, schema);
      if (!parsed.ok) throw new Error(parsed.message);
      expect(printFormula(parsed.expr, schema)).toBe(text);
    }
  });
});
