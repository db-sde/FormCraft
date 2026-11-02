import { describe, expect, it } from "vitest";
import type { FormSchemaV1, QuestionV1 } from "@/domains/forms/schema/v1";
import { parseFormSchema } from "@/domains/forms/schema/validate";
import { analyzeLogic } from "@/domains/forms/schema/analyze";
import {
  applyVariant,
  assignVariant,
  hasLogic,
  ORIGINAL,
  variantProblems,
} from "@/domains/forms/variants";
import { compareArms } from "@/domains/experiments/stats";
import {
  applyEdit,
  describeChanges,
  type EditDraft,
  type EditOperation,
} from "@/domains/ai/form-edit";
import {
  buildCrossTab,
  crossTabRows,
  keysOf,
  NO_ANSWER,
} from "@/domains/responses/crosstab";
import { npsOf, npsTrend, weekOf } from "@/domains/responses/summary";
import { digestPeriod, weekdayOf } from "@/domains/notifications/digest";
import { buildFeedbackReport } from "@/domains/responses/feedback-report";

const theme = {
  primaryColor: "#0f172a",
  backgroundColor: "#ffffff",
  fontFamily: "inter",
  buttonStyle: "rounded",
} as const;

const role = {
  id: "q_role",
  type: "single_select",
  order: 1,
  label: "Your role",
  required: true,
  settings: {
    allowOther: false,
    options: [
      { id: "o_mgr", label: "Manager" },
      { id: "o_peer", label: "Peer" },
      { id: "o_rep", label: "Report" },
    ],
  },
} as QuestionV1;
const score = {
  id: "q_score",
  type: "opinion_scale",
  order: 2,
  label: "How likely are you to recommend us?",
  required: true,
  settings: { min: 0, max: 10 },
} as QuestionV1;
const comment = {
  id: "q_comment",
  type: "long_text",
  order: 3,
  label: "Anything else?",
  required: false,
  settings: {},
} as QuestionV1;

function form(extra: Partial<FormSchemaV1> = {}): FormSchemaV1 {
  return parseFormSchema({
    schemaVersion: 1,
    meta: { title: "Survey" },
    theme,
    endings: [{ id: "end", title: "Thanks", isDefault: true }],
    questions: [
      {
        id: "q_welcome",
        type: "welcome_screen",
        order: 0,
        label: "Hi",
        required: false,
        settings: {},
      },
      role,
      score,
      comment,
    ],
    logic: [],
    ...extra,
  });
}

describe("in-form variants (F-29)", () => {
  const variant = {
    id: "v_b",
    name: "Friendlier",
    questions: { q_role: { label: "What do you do?", options: { o_peer: "Teammate" } } },
    order: ["q_welcome", "q_comment", "q_score", "q_role"],
    layout: "classic" as const,
  };

  it("rewords, reorders and re-lays-out without touching ids", () => {
    const schema = form({ variants: [variant] });
    const b = applyVariant(schema, "v_b");
    expect(b.meta.layout).toBe("classic");
    expect(b.questions.map((q) => q.id)).toEqual(variant.order);
    const roleB = b.questions.find((q) => q.id === "q_role")!;
    expect(roleB.label).toBe("What do you do?");
    expect(
      (roleB.settings as { options: { id: string; label: string }[] }).options,
    ).toEqual([
      { id: "o_mgr", label: "Manager" },
      { id: "o_peer", label: "Teammate" },
      { id: "o_rep", label: "Report" },
    ]);
    expect(applyVariant(schema, ORIGINAL)).toBe(schema);
    expect(applyVariant(schema, "missing")).toBe(schema);
  });

  it("refuses a reorder on a form with logic, and broken references", () => {
    expect(variantProblems(form({ variants: [variant] }))).toEqual([]);
    const withLogic = form({
      variants: [variant],
      questions: [
        ...form().questions.slice(0, 2),
        {
          ...score,
          visibleIf: {
            type: "compare",
            left: { type: "answer", questionId: "q_role" },
            op: "is_not_empty",
          },
        } as QuestionV1,
        comment,
      ],
    });
    expect(hasLogic(withLogic)).toBe(true);
    expect(variantProblems(withLogic).join(" ")).toMatch(/without logic/);
    expect(
      variantProblems(
        form({ variants: [{ id: "v", name: "Bad", order: ["q_role"] }] }),
      ).join(" "),
    ).toMatch(/every question once/);
    expect(
      variantProblems(
        form({
          variants: [{ id: "v", name: "Bad", questions: { q_nope: { label: "x" } } }],
        }),
      ).join(" "),
    ).toMatch(/isn't on the form/);
    expect(analyzeLogic(withLogic).map((i) => i.code)).toContain("variant_invalid");
  });

  it("assigns visitors stably and close to the split", () => {
    expect(assignVariant("t1", "visitor-1", 50, "v_b")).toBe(
      assignVariant("t1", "visitor-1", 50, "v_b"),
    );
    let b = 0;
    for (let i = 0; i < 4000; i += 1)
      if (assignVariant("t1", `v${i}`, 30, "v_b") === "v_b") b += 1;
    expect(b / 4000).toBeGreaterThan(0.26);
    expect(b / 4000).toBeLessThan(0.34);
  });

  it("only calls a winner with 100+ starts per arm and 95% confidence", () => {
    expect(
      compareArms(
        { started: 99, completed: 90, rate: null },
        { started: 500, completed: 100, rate: null },
      ).kind,
    ).toBe("collecting");
    expect(
      compareArms(
        { started: 200, completed: 100, rate: null },
        { started: 200, completed: 104, rate: null },
      ).kind,
    ).toBe("no_difference");
    const lead = compareArms(
      { started: 400, completed: 160, rate: null },
      { started: 400, completed: 220, rate: null },
    );
    expect(lead).toMatchObject({ kind: "leading", arm: "b" });
  });
});

const op = (patch: Partial<EditOperation>): EditOperation => ({
  op: "update_question",
  questionNumber: null,
  afterNumber: null,
  type: null,
  label: null,
  description: null,
  required: null,
  options: [],
  title: null,
  endingId: null,
  primaryColor: null,
  backgroundColor: null,
  fontFamily: null,
  buttonStyle: null,
  rule: null,
  ...patch,
});
const draft = (operations: EditOperation[]): EditDraft => ({
  possible: true,
  reason: "",
  summary: "Edit",
  operations,
});

describe("AI form editing (F-23)", () => {
  it("applies a multi-step edit with numbers from the original form", () => {
    const before = form();
    const result = applyEdit(
      before,
      draft([
        op({ op: "delete_question", questionNumber: 3 }), // the comment
        op({
          op: "update_question",
          questionNumber: 1,
          label: "What's your role?",
          options: ["Manager", "Peer", "Contractor"],
        }),
        op({
          op: "add_question",
          afterNumber: 1,
          type: "email",
          label: "Work email",
          required: true,
        }),
        op({ op: "set_theme", primaryColor: "#14532d" }),
      ]),
    );
    if (!result.ok) throw new Error(result.message);
    const labels = result.schema.questions
      .sort((a, b) => a.order - b.order)
      .map((q) => q.label);
    expect(labels).toEqual([
      "Hi",
      "What's your role?",
      "Work email",
      "How likely are you to recommend us?",
    ]);
    const options = (
      result.schema.questions.find((q) => q.id === "q_role")!.settings as {
        options: { id: string; label: string }[];
      }
    ).options;
    // Kept options keep their ids, so answers and logic stay attached.
    expect(options.slice(0, 2).map((o) => o.id)).toEqual(["o_mgr", "o_peer"]);
    expect(result.schema.theme.primaryColor).toBe("#14532d");
    expect(result.changes).toEqual(
      expect.arrayContaining([
        "Removed “Anything else?”",
        "Reworded “Your role” → “What's your role?”",
        expect.stringMatching(/^Added “Work email” \(email\)/),
        "Theme primary color: #0f172a → #14532d",
      ]),
    );
    expect(before.questions).toHaveLength(4); // the original is untouched
  });

  it("refuses edits that don't pass the form's checks, and says why", () => {
    expect(
      applyEdit(form(), draft([op({ op: "delete_question", questionNumber: 9 })])),
    ).toEqual({
      ok: false,
      message: "There's no question 9 to delete.",
    });
    expect(
      applyEdit(form(), draft([op({ op: "set_theme", primaryColor: "green" })])),
    ).toMatchObject({
      ok: false,
    });
    expect(
      applyEdit(form(), {
        possible: false,
        reason: "No payments here.",
        summary: "",
        operations: [],
      }),
    ).toEqual({ ok: false, message: "No payments here." });
    expect(applyEdit(form(), draft([op({ questionNumber: 1 })]))).toEqual({
      ok: false,
      message: "That wouldn't change anything.",
    });
    expect(describeChanges(form(), form())).toEqual([]);
  });
});

describe("cross-tabs (F-30)", () => {
  const multi = {
    id: "q_multi",
    type: "multi_select",
    order: 4,
    label: "Channels",
    required: false,
    settings: {
      allowOther: true,
      options: [
        { id: "c_web", label: "Web" },
        { id: "c_app", label: "App" },
      ],
    },
  } as QuestionV1;
  const answers = [
    new Map<string, unknown>([
      ["q_role", "o_mgr"],
      ["q_score", 10],
      ["q_multi", ["c_web", "c_app"]],
    ]),
    new Map<string, unknown>([
      ["q_role", "o_peer"],
      ["q_score", 3],
    ]),
    new Map<string, unknown>([
      ["q_role", "o_peer"],
      ["q_multi", ["other:fax"]],
    ]),
    new Map<string, unknown>([["q_score", 9]]),
  ];

  it("adds up to the response count, with a No answer row and column", () => {
    const table = buildCrossTab(role, score, answers);
    const total = table.rowTotals.reduce((s, n) => s + n, 0);
    expect(total).toBe(answers.length);
    expect(table.columnTotals.reduce((s, n) => s + n, 0)).toBe(answers.length);
    const row = (key: string) => table.rows.findIndex((r) => r.key === key);
    const col = (key: string) => table.columns.findIndex((c) => c.key === key);
    expect(table.cells[row("o_peer")][col(NO_ANSWER)]).toBe(1);
    expect(table.cells[row(NO_ANSWER)][col("9")]).toBe(1);
    expect(table.multiCounted).toBe(false);
  });

  it("counts a checkbox answer once per option, and says so", () => {
    const table = buildCrossTab(role, multi, answers);
    expect(table.multiCounted).toBe(true);
    expect(table.rowTotals.reduce((s, n) => s + n, 0)).toBe(5); // 2 + 1 + 1 + 1
    expect(keysOf(multi, ["other:fax"])).toEqual(["other"]);
    const csv = crossTabRows(table, "Role", "Channels");
    expect(csv[0]).toEqual([
      "Role \\ Channels",
      "Web",
      "App",
      "Other",
      "No answer",
      "Total",
    ]);
    expect(csv.at(-1)?.at(-1)).toBe("5");
  });
});

describe("NPS (F-30)", () => {
  it("bins 9–10 / 7–8 / 0–6 and computes the score from counts", () => {
    // 3 promoters, 1 passive, 3 detractors out of 7: (3 - 3) / 7 = 0.
    expect(npsOf([10, 9, 9, 8, 0, 6, 5])).toMatchObject({ score: 0, responses: 7 });
    // 2 promoters, 1 detractor of 3: 33.3 → 33 (not 67 − 33 = 34).
    expect(npsOf([10, 10, 0])).toMatchObject({
      score: 33,
      promoters: 67,
      detractors: 33,
      passives: 0,
    });
    expect(npsOf([])).toBeNull();
  });

  it("trends by week, Monday first", () => {
    expect(weekOf("2026-11-01T23:00:00Z")).toBe("2026-10-26"); // a Sunday
    expect(weekOf("2026-11-02T00:00:00Z")).toBe("2026-11-02");
    expect(
      npsTrend([
        { value: 10, completedAt: "2026-10-27T10:00:00Z" },
        { value: 0, completedAt: "2026-10-28T10:00:00Z" },
        { value: 10, completedAt: "2026-11-03T10:00:00Z" },
        { value: 5, completedAt: null },
      ]),
    ).toEqual([
      { week: "2026-10-26", score: 0, responses: 2 },
      { week: "2026-11-02", score: 100, responses: 1 },
    ]);
  });
});

describe("weekly reports (F-30)", () => {
  it("sends a weekly digest only for a finished Monday–Sunday week", () => {
    expect(weekdayOf("2026-11-01")).toBe(0);
    expect(digestPeriod("weekly", "2026-11-01")).toEqual({
      first: "2026-10-26",
      last: "2026-11-01",
    });
    expect(digestPeriod("weekly", "2026-10-31")).toBeNull();
    expect(digestPeriod("daily", "2026-10-31")).toEqual({
      first: "2026-10-31",
      last: "2026-10-31",
    });
  });
});

describe("confidential 360 report (F-30)", () => {
  const schema = form();
  const rater = (group: string, value: number, text?: string) =>
    new Map<string, unknown>([
      ["q_role", group],
      ["q_score", value],
      ...(text ? [["q_comment", text]] : []),
    ] as [string, unknown][]);

  it("shows nothing until the threshold is reached", () => {
    const report = buildFeedbackReport(
      schema,
      { threshold: 3, groupQuestionId: "q_role" },
      [rater("o_peer", 8), rater("o_peer", 6)],
    );
    expect(report).toMatchObject({
      shown: false,
      responses: 2,
      scores: [],
      comments: [],
    });
  });

  it("never shows a group under the threshold, even by subtraction", () => {
    const answers = [
      rater("o_peer", 8, "Great teammate"),
      rater("o_peer", 6, "Shares context"),
      rater("o_peer", 7, "Calm under pressure"),
      rater("o_mgr", 2, "Misses deadlines"),
    ];
    const report = buildFeedbackReport(
      schema,
      { threshold: 3, groupQuestionId: "q_role" },
      answers,
    );
    // The lone manager joins the smallest shown group, so the overall
    // minus the groups can't reveal their rating.
    expect(report.groups).toEqual([{ label: "Peer and others", responses: 4 }]);
    const nps = report.scores.find((s) => s.questionId === "q_score")!;
    expect(nps.overall).toBe(nps.byGroup[0]);
    expect(report.hiddenResponses).toBe(0);
    // Comments: all of them, in an order that isn't submission order.
    expect(report.comments[0].texts.sort()).toEqual(
      [
        "Calm under pressure",
        "Great teammate",
        "Misses deadlines",
        "Shares context",
      ].sort(),
    );
  });

  it("pools small groups into Others once that pool is big enough", () => {
    const answers = [
      ...[8, 7, 9].map((v) => rater("o_peer", v)),
      rater("o_mgr", 5),
      rater("o_rep", 6),
      rater("o_rep", 4),
    ];
    const report = buildFeedbackReport(
      schema,
      { threshold: 3, groupQuestionId: "q_role" },
      answers,
    );
    expect(report.groups).toEqual([
      { label: "Peer", responses: 3 },
      { label: "Others", responses: 3 },
    ]);
    const s = report.scores.find((x) => x.questionId === "q_score")!;
    expect(s.byGroup).toEqual([8, 5]);
  });
});
