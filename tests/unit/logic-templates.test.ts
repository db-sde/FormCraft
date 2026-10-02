import { describe, expect, it } from "vitest";
import {
  compileFormSchema,
  parseFormSchema,
  validateSemantics,
  analyzeLogic,
} from "@/domains/forms/schema";
import { renderRecall, walkForm } from "@/domains/logic";
import { LOGIC_TEMPLATES } from "@/domains/templates/logic-templates";

function load(title: string) {
  const template = LOGIC_TEMPLATES.find((t) => t.title === title)!;
  const schema = parseFormSchema(template.schema);
  validateSemantics(schema);
  return compileFormSchema(schema);
}

function byName(compiled: ReturnType<typeof load>, variables: Record<string, unknown>) {
  return Object.fromEntries(
    (compiled.schema.variables ?? []).map((v) => [v.name, variables[v.id]]),
  );
}

describe("logic templates", () => {
  it.each(LOGIC_TEMPLATES.map((t) => [t.title]))(
    "%s is valid, publishable and warning-free",
    (title) => {
      const compiled = load(title);
      expect(analyzeLogic(compiled.schema)).toEqual([]);
    },
  );

  it("knowledge quiz: scores, percentage and grade", () => {
    const quiz = load("Knowledge quiz");
    const perfect = walkForm(quiz, {
      q_capital: "o_canberra",
      q_planet: "o_mercury",
      q_primes: ["o_2", "o_11"],
    });
    expect(byName(quiz, perfect.variables)).toEqual({
      score: 3,
      percent: 100,
      grade: "Excellent",
    });
    const shaky = walkForm(quiz, {
      q_capital: "o_sydney",
      q_planet: "o_mercury",
      q_primes: ["o_2", "o_9"],
    });
    expect(byName(quiz, shaky.variables)).toEqual({
      score: 1,
      percent: 33,
      grade: "Keep practising",
    });
    const ending = quiz.schema.endings[0];
    expect(
      renderRecall(ending.title, {
        schema: quiz.schema,
        answers: {},
        variables: perfect.variables,
        hidden: {},
      }),
    ).toBe("You scored 3 out of 3 (100%)");
  });

  it("outcome quiz: the highest score picks the ending", () => {
    const quiz = load("Which work style are you?");
    expect(
      walkForm(quiz, {
        q_weekend: "o_fix",
        q_meeting: "o_sketch",
        q_praise: "o_original",
      }).endingId,
    ).toBe("e_creative");
    expect(
      walkForm(quiz, { q_weekend: "o_plan", q_meeting: "o_why", q_praise: "o_reliable" })
        .endingId,
    ).toBe("e_strategist");
  });

  it("lead qualification: scores, segments and routes", () => {
    const form = load("B2B lead qualification");
    const big = walkForm(
      form,
      {
        q_size: "o_200",
        q_budget: 10000,
        q_timeline: "o_now",
        q_security: true,
        q_contact: { name: "Ada", email: "ada@example.com" },
      },
      { hidden: { source: "linkedin" } },
    );
    expect(big.endingId).toBe("e_book");
    expect(big.visitedQuestionIds).toContain("q_security");
    expect(byName(form, big.variables)).toMatchObject({
      lead_score: 100,
      segment: "enterprise",
      qualified: true,
      first_name: "Ada",
    });

    const small = walkForm(form, {
      q_size: "o_1_10",
      q_budget: 500,
      q_timeline: "o_later",
      q_contact: { name: "Bo", email: "b@e.co" },
    });
    expect(small.endingId).toBe("e_thanks");
    expect(small.visitedQuestionIds).not.toContain("q_security");
    expect(byName(form, small.variables)).toMatchObject({
      lead_score: 7,
      segment: "smb",
      qualified: false,
    });
  });

  it("price estimate: subtotal, discount and total", () => {
    const form = load("Price estimate");
    const quote = walkForm(form, {
      q_plan: "o_pro",
      q_seats: 4,
      q_support: true,
      q_coupon: "SAVE10",
    });
    expect(byName(form, quote.variables)).toMatchObject({
      subtotal: 150,
      discount: 15,
      total: 135,
    });
    const basic = walkForm(form, { q_plan: "o_basic", q_seats: 3, q_support: false });
    expect(byName(form, basic.variables)).toMatchObject({
      subtotal: 30,
      discount: 0,
      total: 30,
    });
  });

  it("eligibility: passes, or explains every failed requirement", () => {
    const form = load("Scholarship eligibility");
    const now = new Date("2026-10-02T12:00:00Z");
    const yes = walkForm(
      form,
      {
        q_dob: "2000-01-01",
        q_country: "o_in",
        q_student: true,
        q_student_id: "S1",
        q_income: 100000,
      },
      { now },
    );
    expect(yes.endingId).toBe("e_yes");
    const no = walkForm(
      form,
      { q_dob: "2015-01-01", q_country: "o_other", q_student: false, q_income: 100000 },
      { now },
    );
    expect(no.endingId).toBe("e_no");
    expect(no.visitedQuestionIds).not.toContain("q_student_id");
    expect(byName(form, no.variables).failed).toEqual([
      "age 18 or over",
      "living in India or the UK",
      "being a student",
    ]);
  });
});
