import { describe, expect, it } from "vitest";
import { validateAnswer, hasAnswer } from "@/domains/logic/validate-answer";
import type { QuestionV1 } from "@/domains/forms/schema/v1";

function q<T extends QuestionV1["type"]>(
  type: T,
  settings: Extract<QuestionV1, { type: T }>["settings"],
  required = false,
): QuestionV1 {
  return { id: "q", type, order: 0, label: "Q", required, settings } as QuestionV1;
}

const options = [
  { id: "a", label: "A" },
  { id: "b", label: "B" },
];

describe("validateAnswer — required vs empty", () => {
  it("rejects an empty required answer and accepts an empty optional one", () => {
    expect(validateAnswer(q("short_text", {}, true), "").ok).toBe(false);
    expect(validateAnswer(q("short_text", {}, true), "   ").ok).toBe(false);
    expect(validateAnswer(q("short_text", {}, false), undefined).ok).toBe(true);
  });

  it("never blocks welcome screens or statements", () => {
    expect(validateAnswer(q("welcome_screen", {}, true), undefined).ok).toBe(true);
    expect(validateAnswer(q("statement", {}, true), undefined).ok).toBe(true);
  });

  it("treats a selected-but-blank Other as unanswered", () => {
    const single = q("single_select", { options, allowOther: true }, true);
    expect(hasAnswer(single, "other:")).toBe(false);
    expect(validateAnswer(single, "other:   ").ok).toBe(false);
    expect(validateAnswer(single, "other:Purple").ok).toBe(true);
  });
});

describe("validateAnswer — formats", () => {
  it("email", () => {
    const email = q("email", {});
    expect(validateAnswer(email, "not-an-email").ok).toBe(false);
    expect(validateAnswer(email, "a@b").ok).toBe(false);
    expect(validateAnswer(email, "ada@example.com").ok).toBe(true);
  });

  it("url accepts bare domains and rejects junk / non-http schemes", () => {
    const url = q("url", {});
    expect(validateAnswer(url, "example.com").ok).toBe(true);
    expect(validateAnswer(url, "https://example.com/path").ok).toBe(true);
    expect(validateAnswer(url, "not a url").ok).toBe(false);
    expect(validateAnswer(url, "javascript:alert(1)").ok).toBe(false);
  });

  it("phone requires 7–15 digits of phone-ish characters", () => {
    const phone = q("phone", {});
    expect(validateAnswer(phone, "+1 (555) 123-4567").ok).toBe(true);
    expect(validateAnswer(phone, "123").ok).toBe(false);
    expect(validateAnswer(phone, "call me maybe").ok).toBe(false);
  });

  it("number range and decimals", () => {
    const n = q("number", { min: 1, max: 10, decimals: 0 });
    expect(validateAnswer(n, 999).ok).toBe(false);
    expect(validateAnswer(n, 0).ok).toBe(false);
    expect(validateAnswer(n, 5).ok).toBe(true);
    expect(validateAnswer(n, 5.5).ok).toBe(false);
    expect(validateAnswer(n, "5").ok).toBe(false);
  });

  it("text length bounds count trimmed characters", () => {
    const t = q("short_text", { minLength: 3, maxLength: 5 });
    expect(validateAnswer(t, "ab").ok).toBe(false);
    expect(validateAnswer(t, "abcd").ok).toBe(true);
    expect(validateAnswer(t, "abcdef").ok).toBe(false);
  });

  it("date validity and bounds", () => {
    const d = q("date", { minDate: "2026-01-01", maxDate: "2026-12-31" });
    expect(validateAnswer(d, "2026-02-30").ok).toBe(false);
    expect(validateAnswer(d, "2025-12-31").ok).toBe(false);
    expect(validateAnswer(d, "2026-06-15").ok).toBe(true);
  });
});

describe("validateAnswer — choices", () => {
  it("single select only accepts listed ids (or Other when allowed)", () => {
    expect(
      validateAnswer(q("single_select", { options, allowOther: false }), "a").ok,
    ).toBe(true);
    expect(
      validateAnswer(q("single_select", { options, allowOther: false }), "zzz").ok,
    ).toBe(false);
    expect(
      validateAnswer(q("single_select", { options, allowOther: false }), "other:x").ok,
    ).toBe(false);
  });

  it("multi select enforces min/max and rejects duplicates", () => {
    const m = q("multi_select", {
      options,
      allowOther: false,
      minSelections: 1,
      maxSelections: 1,
    });
    expect(validateAnswer(m, ["a"]).ok).toBe(true);
    expect(validateAnswer(m, ["a", "b"]).ok).toBe(false);
    const dup = q("multi_select", { options, allowOther: false });
    expect(validateAnswer(dup, ["a", "a"]).ok).toBe(false);
  });

  it("rating and opinion scale stay within their bounds", () => {
    expect(validateAnswer(q("rating", { scale: 5 }), 6).ok).toBe(false);
    expect(validateAnswer(q("rating", { scale: 5 }), 3).ok).toBe(true);
    expect(validateAnswer(q("opinion_scale", { min: 0, max: 10 }), 11).ok).toBe(false);
    expect(validateAnswer(q("opinion_scale", { min: 0, max: 10 }), 0).ok).toBe(true);
  });

  it("yes/no only accepts booleans", () => {
    expect(validateAnswer(q("yes_no", {}, true), "yes").ok).toBe(false);
    expect(validateAnswer(q("yes_no", {}, true), false).ok).toBe(true);
  });
});
