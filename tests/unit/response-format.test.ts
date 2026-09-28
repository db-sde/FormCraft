import { describe, expect, it } from "vitest";
import { formatAnswerValue, questionColumnLabel } from "@/domains/responses/format";
import type { QuestionV1 } from "@/domains/forms/schema/v1";

const singleSelect: QuestionV1 = {
  id: "q1",
  type: "single_select",
  order: 0,
  label: "Favorite color",
  required: true,
  settings: {
    options: [
      { id: "opt_red", label: "Red" },
      { id: "opt_blue", label: "Blue" },
    ],
    allowOther: true,
  },
};

const multiSelect: QuestionV1 = {
  id: "q2",
  type: "multi_select",
  order: 1,
  label: "Toppings",
  required: false,
  settings: {
    options: [
      { id: "opt_cheese", label: "Cheese" },
      { id: "opt_pepperoni", label: "Pepperoni" },
    ],
    allowOther: false,
  },
};

const yesNo: QuestionV1 = {
  id: "q3",
  type: "yes_no",
  order: 2,
  label: "Subscribe?",
  required: false,
  settings: { yesLabel: "Yep", noLabel: "Nope" },
};

describe("formatAnswerValue", () => {
  it("resolves a single_select option id to its label, not the raw id", () => {
    expect(formatAnswerValue(singleSelect, "opt_blue")).toBe("Blue");
  });

  it("shows the free-text value for an 'other' single_select answer", () => {
    expect(formatAnswerValue(singleSelect, "other:Teal")).toBe("Teal");
  });

  it("joins multi_select labels stably, not raw ids", () => {
    expect(formatAnswerValue(multiSelect, ["opt_pepperoni", "opt_cheese"])).toBe(
      "Pepperoni; Cheese",
    );
  });

  it("uses the question's configured yes/no labels", () => {
    expect(formatAnswerValue(yesNo, true)).toBe("Yep");
    expect(formatAnswerValue(yesNo, false)).toBe("Nope");
  });

  it("returns an empty string for an unanswered question", () => {
    expect(formatAnswerValue(singleSelect, undefined)).toBe("");
    expect(formatAnswerValue(singleSelect, null)).toBe("");
  });

  it("passes plain text/number answers through as strings", () => {
    const shortText: QuestionV1 = {
      id: "q4",
      type: "short_text",
      order: 3,
      label: "Name",
      required: true,
      settings: {},
    };
    expect(formatAnswerValue(shortText, "Ada")).toBe("Ada");
  });
});

describe("questionColumnLabel", () => {
  it("uses the question label", () => {
    expect(questionColumnLabel(singleSelect)).toBe("Favorite color");
  });

  it("falls back to the question id when the label is blank", () => {
    const blank: QuestionV1 = { ...singleSelect, label: "   " };
    expect(questionColumnLabel(blank)).toBe("q1");
  });
});
