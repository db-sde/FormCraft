import { describe, expect, it } from "vitest";
import type { QuestionV1 } from "@/domains/forms/schema/v1";
import { parseFormSchema } from "@/domains/forms/schema";
import {
  validateAnswer,
  validateContactField,
  hasAnswer,
} from "@/domains/logic/validate-answer";
import { isAnswered } from "@/domains/logic/evaluate";
import {
  answerCells,
  formatAnswerValue,
  questionColumnLabels,
} from "@/domains/responses/format";
import { createQuestion } from "@/domains/forms/builder";

const contact: QuestionV1 = {
  id: "q_contact",
  type: "contact_info",
  order: 0,
  label: "Where can we reach you?",
  required: true,
  settings: { fields: ["name", "email", "phone"], requiredFields: ["name", "email"] },
};

describe("one contact detail at a time", () => {
  const block = contact as Extract<QuestionV1, { type: "contact_info" }>;

  it("checks only the detail on screen", () => {
    // Email is still empty and required, but the name screen doesn't care.
    expect(validateContactField(block, "name", { name: "Ada" })).toEqual({ ok: true });
    expect(validateContactField(block, "email", { name: "Ada" })).toEqual({
      ok: false,
      message: "Enter your email.",
    });
  });

  it("lets an optional detail be skipped but not malformed", () => {
    expect(validateContactField(block, "phone", {})).toEqual({ ok: true });
    expect(validateContactField(block, "phone", { phone: "abc" })).toMatchObject({
      ok: false,
    });
  });

  it("holds the same rules as the whole-block check", () => {
    expect(validateContactField(block, "email", { email: "nope" })).toEqual({
      ok: false,
      message: "Enter a valid email address.",
    });
    expect(validateContactField(block, "name", undefined)).toEqual({
      ok: false,
      message: "Enter your name.",
    });
  });
});

describe("contact info validation", () => {
  it("requires each required field, naming the missing one", () => {
    expect(validateAnswer(contact, undefined)).toEqual({
      ok: false,
      message: "Enter your name.",
    });
    expect(validateAnswer(contact, { name: "Ada" })).toEqual({
      ok: false,
      message: "Enter your email.",
    });
  });

  it("accepts a complete lead with the optional field blank", () => {
    expect(validateAnswer(contact, { name: "Ada", email: "ada@example.com" })).toEqual({
      ok: true,
    });
  });

  it("checks email and phone formats", () => {
    expect(validateAnswer(contact, { name: "Ada", email: "nope" })).toMatchObject({
      ok: false,
      message: "Enter a valid email address.",
    });
    expect(
      validateAnswer(contact, { name: "Ada", email: "ada@example.com", phone: "12" }),
    ).toMatchObject({ ok: false, message: "Enter a valid phone number." });
  });

  it("rejects fields the block doesn't show and non-object values", () => {
    expect(
      validateAnswer(contact, { name: "Ada", email: "ada@example.com", company: "X" }).ok,
    ).toBe(false);
    expect(validateAnswer(contact, "Ada").ok).toBe(false);
  });

  it("counts as answered once any field has text", () => {
    expect(hasAnswer(contact, { name: " " })).toBe(false);
    expect(hasAnswer(contact, { phone: "555" })).toBe(true);
    expect(isAnswered({ email: "" })).toBe(false);
    expect(isAnswered({ email: "a@b.co" })).toBe(true);
  });
});

describe("contact info formatting and export", () => {
  it("formats as the filled fields in order", () => {
    expect(formatAnswerValue(contact, { email: "ada@example.com", name: "Ada" })).toBe(
      "Ada · ada@example.com",
    );
  });

  it("exports one column per field", () => {
    expect(questionColumnLabels(contact)).toEqual([
      "Where can we reach you? (Name)",
      "Where can we reach you? (Email)",
      "Where can we reach you? (Phone)",
    ]);
    expect(answerCells(contact, contact, { name: "Ada", phone: "+1 555 0100" })).toEqual([
      "Ada",
      "",
      "+1 555 0100",
    ]);
  });
});

describe("contact info schema", () => {
  it("builder default is valid", () => {
    const q = createQuestion("contact_info", 0);
    const schema = parseFormSchema({
      schemaVersion: 1,
      meta: { title: "t" },
      theme: {},
      endings: [{ id: "e", title: "Thanks", isDefault: true }],
      questions: [q],
      logic: [],
    });
    expect(schema.questions[0].type).toBe("contact_info");
  });

  it("rejects a required field that isn't shown", () => {
    expect(() =>
      parseFormSchema({
        schemaVersion: 1,
        meta: { title: "t" },
        theme: {},
        endings: [{ id: "e", title: "Thanks", isDefault: true }],
        questions: [
          { ...contact, settings: { fields: ["name"], requiredFields: ["email"] } },
        ],
        logic: [],
      }),
    ).toThrow();
  });
});
