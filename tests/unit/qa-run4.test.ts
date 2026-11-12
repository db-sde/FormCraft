import { describe, expect, it } from "vitest";
import {
  compileFormSchema,
  parseFormSchema,
  validateForPublish,
  validateSemantics,
} from "@/domains/forms/schema";
import { respondentSchema, scoresUsedMidForm } from "@/domains/forms/respondent-schema";
import { normalizeAnswer } from "@/domains/responses/queries";
import { walkForm } from "@/domains/logic";

/** Fixes from QA run 4 (11 Nov 2026) that are plain functions. */

const quiz = (extra: Record<string, unknown> = {}) =>
  parseFormSchema({
    schemaVersion: 1,
    meta: { title: "Quiz" },
    theme: {},
    endings: [
      { id: "end", title: "You scored {{score}}", isDefault: true },
      { id: "top", title: "Top marks" },
    ],
    questions: [
      {
        id: "q1",
        type: "single_select",
        order: 0,
        label: "Capital of France?",
        required: true,
        settings: {
          allowOther: false,
          options: [
            {
              id: "paris",
              label: "Paris",
              correct: true,
              scores: [{ variableId: "s", points: 10 }],
            },
            { id: "rome", label: "Rome" },
          ],
        },
      },
    ],
    variables: [{ id: "s", name: "score", type: "number" }],
    rules: [
      {
        id: "top",
        on: { event: "form_completed" },
        when: {
          type: "compare",
          left: { type: "variable", variableId: "s" },
          op: "gte",
          right: { type: "literal", value: 10 },
        },
        then: [{ type: "jump_to_ending", endingId: "top" }],
      },
    ],
    logic: [],
    ...extra,
  });

const optionsOf = (schema: ReturnType<typeof quiz>) =>
  (schema.questions[0].settings as { options: Record<string, unknown>[] }).options;

describe("the form a respondent's browser gets (FC4-02)", () => {
  it("has no correct answers or points when scores only matter at the end", () => {
    const schema = quiz();
    expect(scoresUsedMidForm(schema)).toBe(false);
    const sent = respondentSchema(schema);
    expect(JSON.stringify(sent)).not.toContain('"correct"');
    expect(JSON.stringify(sent)).not.toContain('"points"');
    // Labels and ids are untouched; the stored form still has everything.
    expect(optionsOf(sent).map((o) => [o.id, o.label])).toEqual([
      ["paris", "Paris"],
      ["rome", "Rome"],
    ]);
    expect(optionsOf(schema)[0]).toMatchObject({ correct: true });
    // The server's scoring, from the stored form, is unchanged.
    expect(walkForm(compileFormSchema(schema), { q1: "paris" }).endingId).toBe("top");
  });

  it("keeps points when a score decides something mid-form", () => {
    const schema = quiz({
      questions: [
        ...quiz().questions,
        {
          id: "q2",
          type: "short_text",
          order: 1,
          label: "Bonus",
          required: false,
          settings: {},
          visibleIf: {
            type: "compare",
            left: { type: "variable", variableId: "s" },
            op: "gte",
            right: { type: "literal", value: 10 },
          },
        },
      ],
    });
    expect(scoresUsedMidForm(schema)).toBe(true);
    const sent = respondentSchema(schema);
    expect(optionsOf(sent)[0].scores).toEqual([{ variableId: "s", points: 10 }]);
    // Not an adaptive group, so "correct" still goes.
    expect(optionsOf(sent)[0].correct).toBeUndefined();
  });

  it("keeps points when a question's wording shows the score", () => {
    const schema = quiz({
      questions: [
        ...quiz().questions,
        {
          id: "q2",
          type: "statement",
          order: 1,
          label: "So far: {{score}}",
          required: false,
          settings: {},
        },
      ],
    });
    expect(scoresUsedMidForm(schema)).toBe(true);
  });
});

describe("an unfinished Booking question (FC4-09)", () => {
  const withBooking = parseFormSchema({
    schemaVersion: 1,
    meta: { title: "Book" },
    theme: {},
    endings: [{ id: "end", title: "Thanks", isDefault: true }],
    questions: [
      {
        id: "q1",
        type: "booking",
        order: 0,
        label: "Pick a time",
        required: false,
        settings: {},
      },
    ],
    logic: [],
  });

  it("doesn't stop the draft saving, only publishing", () => {
    expect(() => validateSemantics(withBooking)).not.toThrow();
    expect(() => validateForPublish(withBooking)).toThrow(/needs a booking type/);
  });
});

describe("website answers (FC4-19)", () => {
  const url = {
    id: "w",
    type: "url",
    order: 0,
    label: "Website",
    required: false,
    settings: {},
  } as Parameters<typeof normalizeAnswer>[0];

  it("are stored with a scheme", () => {
    expect(normalizeAnswer(url, "example.com")).toBe("https://example.com");
    expect(normalizeAnswer(url, "  http://example.com ")).toBe("http://example.com");
    expect(normalizeAnswer(url, "https://example.com/a")).toBe("https://example.com/a");
    expect(normalizeAnswer(url, "")).toBe("");
  });
});

describe("end-of-form rules (QA FC5-06)", () => {
  it("aren't sent to the browser; question rules are", () => {
    const schema = quiz({
      rules: [
        ...(quiz().rules ?? []),
        {
          id: "jump",
          on: { event: "question_answered", questionId: "q1" },
          then: [{ type: "jump_to_ending", endingId: "end" }],
        },
      ],
    });
    const sent = respondentSchema(schema);
    expect(sent.rules?.map((r) => r.id)).toEqual(["jump"]);
    expect(JSON.stringify(sent)).not.toContain('"gte"');
  });
});

describe("phone answers (QA FC4-19)", () => {
  const phone = (defaultCountry?: string) =>
    ({
      id: "p",
      type: "phone",
      order: 0,
      label: "Phone",
      required: false,
      settings: defaultCountry ? { defaultCountry } : {},
    }) as Parameters<typeof normalizeAnswer>[0];

  it("are stored in the international format when they can be read", () => {
    expect(normalizeAnswer(phone("US"), "415 555 2671")).toBe("+14155552671");
    expect(normalizeAnswer(phone("IN"), "9876543210")).toBe("+919876543210");
    expect(normalizeAnswer(phone(), "+44 20 7946 0958")).toBe("+442079460958");
  });

  it("are kept as typed when they can't", () => {
    expect(normalizeAnswer(phone(), "415 555 2671")).toBe("415 555 2671");
    expect(normalizeAnswer(phone("US"), "12")).toBe("12");
  });
});

describe("phones without a set country (QA run 7, FC4-19)", () => {
  const phone = {
    id: "p",
    type: "phone",
    order: 0,
    label: "Phone",
    required: false,
    settings: {},
  } as Parameters<typeof normalizeAnswer>[0];

  it("are never guessed into a country: kept as typed", () => {
    // QA's "(555) 010-7777", typed from India, became +91…: a global form
    // can't assume where a number is from.
    expect(normalizeAnswer(phone, "(555) 010-7777")).toBe("(555) 010-7777");
    expect(normalizeAnswer(phone, "415 555 2671")).toBe("415 555 2671");
  });

  it("are converted when the respondent typed the country code", () => {
    expect(normalizeAnswer(phone, "+1 415 555 2671")).toBe("+14155552671");
    expect(normalizeAnswer(phone, "+91 98765 43210")).toBe("+919876543210");
  });

  it("aren't converted when the number isn't real in the set country", () => {
    const india = { ...phone, settings: { defaultCountry: "IN" } } as typeof phone;
    expect(normalizeAnswer(india, "98765 43210")).toBe("+919876543210");
    // Right length, but no Indian number starts with 5.
    expect(normalizeAnswer(india, "5550107777")).toBe("5550107777");
  });
});
