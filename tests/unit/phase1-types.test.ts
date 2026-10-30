import { describe, expect, it } from "vitest";
import type { FormSchemaV1, QuestionV1 } from "@/domains/forms/schema/v1";
import { parseFormSchema, validateSemantics } from "@/domains/forms/schema/validate";
import { compileFormSchema } from "@/domains/forms/schema/compile";
import { analyzeLogic } from "@/domains/forms/schema/analyze";
import { validateAnswer, walkForm, hasAnswer } from "@/domains/logic";
import { toValue } from "@/domains/logic/expressions";
import {
  dateTimeValue,
  formatDateTime,
  offeredTimes,
  offsetsForWallTime,
  parseDateTime,
} from "@/domains/logic/datetime";
import {
  answerCells,
  formatAnswerValue,
  questionColumnLabels,
} from "@/domains/responses/format";
import { summarizeAnswers } from "@/domains/responses/summary";
import { prefillFromParams, prefillValue } from "@/domains/forms/prefill";
import { nextPageWithContent, shownOnPage, splitPages } from "@/domains/forms/pages";
import {
  customCssErrors,
  customCssProblems,
  scopedCustomCss,
} from "@/domains/themes/custom-css";

const q = (o: Partial<QuestionV1> & { id: string; type: QuestionV1["type"] }) =>
  ({ order: 0, label: o.id, required: false, settings: {}, ...o }) as QuestionV1;

const time = q({
  id: "t",
  type: "time",
  settings: { minTime: "09:00", maxTime: "17:00", stepMinutes: 15, hourCycle: "12" },
} as never);
const matrix = q({
  id: "m",
  type: "matrix",
  required: true,
  settings: {
    rows: [
      { id: "r1", label: "Speed" },
      { id: "r2", label: "Quality" },
    ],
    columns: [
      { id: "c1", label: "Poor" },
      { id: "c2", label: "Good" },
    ],
    multiple: false,
  },
} as never);
const ranking = q({
  id: "k",
  type: "ranking",
  settings: {
    rankCount: 2,
    options: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ],
  },
} as never);
const address = q({
  id: "ad",
  type: "address",
  required: true,
  settings: {
    fields: ["line1", "city", "postalCode", "country"],
    requiredFields: ["line1", "country"],
  },
} as never);

describe("time (F-20)", () => {
  it("offers only times in the window, on the step", () => {
    const times = offeredTimes({ minTime: "09:00", maxTime: "10:00", stepMinutes: 15 });
    expect(times).toEqual(["09:00", "09:15", "09:30", "09:45", "10:00"]);
  });
  it("stores 24-hour HH:mm and enforces window and step on the server", () => {
    expect(validateAnswer(time, "14:30").ok).toBe(true);
    expect(validateAnswer(time, "08:45")).toMatchObject({
      ok: false,
      message: "Choose 9:00 AM or later.",
    });
    expect(validateAnswer(time, "17:15")).toMatchObject({
      ok: false,
      message: "Choose 5:00 PM or earlier.",
    });
    expect(validateAnswer(time, "14:20").ok).toBe(false);
    expect(validateAnswer(time, "2:30 PM").ok).toBe(false);
  });
});

describe("date and time (F-20)", () => {
  const dt = (settings: object) => q({ id: "d", type: "datetime", settings } as never);

  it("keeps the wall time and its offset, in the question's zone", () => {
    expect(dateTimeValue("2026-11-20", "18:30", "Asia/Kolkata")).toBe(
      "2026-11-20T18:30+05:30",
    );
    expect(
      validateAnswer(dt({ timeZone: "Asia/Kolkata" }), "2026-11-20T18:30+05:30").ok,
    ).toBe(true);
    // The right wall time with the wrong offset for that zone.
    expect(
      validateAnswer(dt({ timeZone: "Asia/Kolkata" }), "2026-11-20T18:30+01:00").ok,
    ).toBe(false);
  });

  it("follows daylight saving: a skipped hour doesn't exist, a repeated one has two offsets", () => {
    // New York, 8 March 2026: 02:00 jumps to 03:00.
    expect(offsetsForWallTime("2026-03-08T02:30", "America/New_York")).toEqual([]);
    expect(
      validateAnswer(dt({ timeZone: "America/New_York" }), "2026-03-08T02:30-05:00"),
    ).toMatchObject({
      ok: false,
    });
    // 1 November 2026: 01:30 happens twice — EDT first, then EST.
    expect(offsetsForWallTime("2026-11-01T01:30", "America/New_York")).toEqual([
      -240, -300,
    ]);
    expect(dateTimeValue("2026-11-01", "01:30", "America/New_York")).toBe(
      "2026-11-01T01:30-04:00",
    );
    expect(
      validateAnswer(dt({ timeZone: "America/New_York" }), "2026-11-01T01:30-05:00").ok,
    ).toBe(true);
    // Summer and winter offsets for the same zone.
    expect(dateTimeValue("2026-07-01", "09:00", "Europe/London")).toBe(
      "2026-07-01T09:00+01:00",
    );
    expect(dateTimeValue("2026-12-01", "09:00", "Europe/London")).toBe(
      "2026-12-01T09:00+00:00",
    );
  });

  it("checks dates, the time window, and reads as a date in logic and exports", () => {
    const q1 = dt({
      minDate: "2026-11-01",
      maxDate: "2026-11-30",
      minTime: "09:00",
      stepMinutes: 30,
    });
    expect(validateAnswer(q1, "2026-10-31T10:00+00:00").ok).toBe(false);
    expect(validateAnswer(q1, "2026-11-10T08:30+00:00").ok).toBe(false);
    expect(validateAnswer(q1, "2026-11-10T09:30+00:00").ok).toBe(true);
    expect(parseDateTime("2026-11-10T09:30+00:00")).toEqual({
      date: "2026-11-10",
      time: "09:30",
      offsetMinutes: 0,
    });
    expect(formatDateTime("2026-11-20T18:30+05:30")).toBe("2026-11-20 18:30 (UTC+05:30)");
  });
});

describe("address (F-13)", () => {
  it("requires the required parts, accepts any country's format, refuses unknown parts", () => {
    expect(validateAnswer(address, { line1: "1 Rue X", country: "France" }).ok).toBe(
      true,
    );
    expect(validateAnswer(address, { line1: "1 Rue X" })).toMatchObject({
      ok: false,
      message: "Enter the country.",
    });
    expect(validateAnswer(address, { line1: "x", country: "y", state: "z" }).ok).toBe(
      false,
    );
    expect(
      validateAnswer(address, { line1: "x", country: "y", postalCode: "SW1A 1AA" }).ok,
    ).toBe(true);
    expect(
      validateAnswer({ ...address, required: false } as QuestionV1, undefined).ok,
    ).toBe(true);
  });
  it("exports one column per part", () => {
    expect(questionColumnLabels(address)).toEqual([
      "ad (Address line 1)",
      "ad (City)",
      "ad (Postal code)",
      "ad (Country)",
    ]);
    expect(
      answerCells(address, address, { line1: "1 Main St", country: "India" }),
    ).toEqual(["1 Main St", "", "", "India"]);
  });
});

describe("matrix (F-11)", () => {
  it("stores one answer per row and blocks missing required rows", () => {
    expect(validateAnswer(matrix, { r1: "c1", r2: "c2" }).ok).toBe(true);
    expect(validateAnswer(matrix, { r1: "c1" })).toMatchObject({
      ok: false,
      message: "Answer “Quality”.",
    });
    expect(validateAnswer(matrix, { r1: "zz", r2: "c1" }).ok).toBe(false);
    expect(validateAnswer(matrix, { r9: "c1", r1: "c1", r2: "c1" }).ok).toBe(false);
    const multi = {
      ...matrix,
      settings: { ...matrix.settings, multiple: true },
    } as QuestionV1;
    expect(validateAnswer(multi, { r1: ["c1", "c2"], r2: ["c2"] }).ok).toBe(true);
    expect(validateAnswer(multi, { r1: ["c1", "c1"], r2: ["c2"] }).ok).toBe(false);
  });
  it("lets logic read a row, and exports each row as its own column", () => {
    expect(toValue({ r1: "c2" }, "r1")).toBe("c2");
    expect(toValue({ r1: ["c1", "c2"] }, "r1")).toEqual(["c1", "c2"]);
    expect(questionColumnLabels(matrix)).toEqual(["m (Speed)", "m (Quality)"]);
    expect(answerCells(matrix, matrix, { r1: "c2" })).toEqual(["Good", ""]);
    expect(formatAnswerValue(matrix, { r1: "c2", r2: "c1" })).toBe(
      "Speed: Good; Quality: Poor",
    );
  });
});

describe("ranking (F-18)", () => {
  it("needs exactly the configured top N, with no repeats", () => {
    expect(validateAnswer(ranking, ["c", "a"]).ok).toBe(true);
    expect(validateAnswer(ranking, ["c"])).toMatchObject({
      ok: false,
      message: "Rank your top 2.",
    });
    expect(validateAnswer(ranking, ["c", "c"]).ok).toBe(false);
    expect(validateAnswer(ranking, ["c", "x"]).ok).toBe(false);
    expect(validateAnswer(ranking, undefined).ok).toBe(true);
    expect(
      validateAnswer({ ...ranking, required: true } as QuestionV1, undefined).ok,
    ).toBe(false);
  });
  it("gives logic each option's place, and exports the order", () => {
    expect(toValue(["c", "a"], "a")).toBe(2);
    expect(toValue(["c", "a"], "b")).toBeNull();
    expect(formatAnswerValue(ranking, ["c", "a"])).toBe("1. C; 2. A");
  });
});

describe("summaries", () => {
  it("counts matrix rows and averages ranking places", () => {
    const schema = { questions: [matrix, ranking] } as unknown as FormSchemaV1;
    const [m, k] = summarizeAnswers(schema, [
      new Map<string, unknown>([
        ["m", { r1: "c1", r2: "c2" }],
        ["k", ["a", "b"]],
      ]),
      new Map<string, unknown>([
        ["m", { r1: "c2", r2: "c2" }],
        ["k", ["a", "c"]],
      ]),
    ]);
    expect(m).toMatchObject({
      kind: "matrix",
      rows: [{ counts: [1, 1] }, { counts: [0, 2] }],
    });
    expect(k.kind).toBe("ranking");
    if (k.kind === "ranking") {
      expect(k.items[0]).toMatchObject({ label: "A", averageRank: 1, first: 2 });
      expect(k.items.map((i) => i.label)).toEqual(["A", "B", "C"]);
    }
    expect(hasAnswer(matrix, {})).toBe(false);
  });
});

describe("link prefill (F-28)", () => {
  const choice = q({
    id: "c",
    type: "single_select",
    prefillKey: "plan",
    settings: { allowOther: false, options: [{ id: "o1", label: "Pro" }] },
  } as never);
  const email = q({ id: "e", type: "email", prefillKey: "email" });
  it("fills validated values, matching options by label, and ignores the rest", () => {
    const params = new URLSearchParams("plan=pro&email=not-an-email&other=1");
    expect(prefillFromParams([choice, email], params)).toEqual({ c: "o1" });
    expect(prefillValue(email, "ada@example.com")).toBe("ada@example.com");
    expect(prefillValue(q({ id: "y", type: "yes_no" }), "yes")).toBe(true);
    // Types a link can't fill are never filled.
    expect(prefillValue(address, "anything")).toBeUndefined();
  });
  it("is checked: no reserved names, URL-field clashes or duplicates", () => {
    const schema = parseFormSchema({
      schemaVersion: 1,
      meta: { title: "x" },
      theme: {},
      endings: [{ id: "e", title: "t", isDefault: true }],
      hiddenFields: [{ name: "source" }],
      logic: [],
      questions: [
        {
          id: "a",
          type: "short_text",
          order: 0,
          label: "A",
          prefillKey: "lang",
          settings: {},
        },
        {
          id: "b",
          type: "short_text",
          order: 1,
          label: "B",
          prefillKey: "source",
          settings: {},
        },
        {
          id: "c",
          type: "short_text",
          order: 2,
          label: "C",
          prefillKey: "x",
          settings: {},
        },
        {
          id: "d",
          type: "short_text",
          order: 3,
          label: "D",
          prefillKey: "x",
          settings: {},
        },
      ],
    });
    const codes = analyzeLogic(schema).map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "prefill_reserved",
        "prefill_hidden_clash",
        "prefill_duplicate",
      ]),
    );
  });
});

describe("custom CSS (F-14)", () => {
  it("refuses what could escape the style sheet or load anything", () => {
    expect(customCssErrors("</style><script>alert(1)</script>")).not.toEqual([]);
    expect(customCssErrors("@import url(https://evil.example/x.css);")).not.toEqual([]);
    expect(customCssErrors("a { background: url(javascript:alert(1)) }")).not.toEqual([]);
    expect(customCssErrors("} body { display: none }")).not.toEqual([]);
    expect(customCssErrors(".fc-question-label { color: red }")).toEqual([]);
  });
  it("nests the CSS inside the form's scope and closes what's left open", () => {
    expect(scopedCustomCss(".fc-button { color: red }")).toBe(
      ".fc-custom-scope{.fc-button { color: red }}",
    );
    expect(scopedCustomCss(".a { color: red")).toBe(".fc-custom-scope{.a { color: red}}");
    expect(customCssProblems(".a { color: red")[0].severity).toBe("warning");
    expect(scopedCustomCss("<")).toBeNull();
  });
  it("is refused by the schema, so an unsafe draft can't be saved", () => {
    expect(() =>
      parseFormSchema({
        schemaVersion: 1,
        meta: { title: "x" },
        theme: { customCss: "@import url(x.css);" },
        endings: [{ id: "e", title: "t", isDefault: true }],
        logic: [],
        questions: [{ id: "a", type: "short_text", order: 0, label: "A", settings: {} }],
      }),
    ).toThrow();
  });
});

describe("classic pages (F-01)", () => {
  const schema = parseFormSchema({
    schemaVersion: 1,
    meta: { title: "Pages", layout: "classic" },
    theme: {},
    endings: [{ id: "end", title: "Done", isDefault: true }],
    logic: [],
    rules: [
      {
        id: "skip",
        on: { event: "question_answered", questionId: "q1" },
        when: {
          type: "compare",
          left: { type: "answer", questionId: "q1" },
          op: "eq",
          right: { type: "literal", value: true },
        },
        then: [{ type: "jump_to_question", questionId: "q4" }],
      },
    ],
    questions: [
      { id: "q1", type: "yes_no", order: 0, label: "Skip ahead?", settings: {} },
      { id: "pb1", type: "page_break", order: 1, label: "Two", settings: {} },
      { id: "q2", type: "short_text", order: 2, label: "B", settings: {} },
      { id: "q3", type: "short_text", order: 3, label: "C", settings: {} },
      { id: "pb2", type: "page_break", order: 4, label: "Three", settings: {} },
      { id: "q4", type: "short_text", order: 5, label: "D", settings: {} },
    ],
  });
  validateSemantics(schema);
  const compiled = compileFormSchema(schema);
  const pages = splitPages(compiled);

  it("splits at page breaks, which nobody is ever asked", () => {
    expect(pages.map((p) => [p.title, p.ids])).toEqual([
      [undefined, ["q1"]],
      ["Two", ["q2", "q3"]],
      ["Three", ["q4"]],
    ]);
    expect(walkForm(compiled, {}).visitedQuestionIds).toEqual(["q1", "q2", "q3", "q4"]);
  });

  it("follows the same logic: a jump leaves out the pages in between", () => {
    const onPath = new Set(walkForm(compiled, { q1: true }).visitedQuestionIds);
    expect(shownOnPage(pages[1], onPath)).toEqual([]);
    expect(nextPageWithContent(pages, onPath, 1)).toBe(2);
    const otherwise = new Set(walkForm(compiled, { q1: false }).visitedQuestionIds);
    expect(nextPageWithContent(pages, otherwise, 1)).toBe(1);
  });

  it("doesn't let rules run on a page break", () => {
    const bad = {
      ...schema,
      rules: [
        {
          id: "r",
          on: { event: "question_answered" as const, questionId: "pb1" },
          then: [],
        },
      ],
    };
    expect(analyzeLogic(bad).map((i) => i.code)).toContain("rule_on_page_break");
  });
});
