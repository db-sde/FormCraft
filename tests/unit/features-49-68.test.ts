import { describe, expect, it } from "vitest";
import { compileFormSchema, parseFormSchema } from "@/domains/forms/schema";
import {
  afterReviewEdit,
  formProgress,
  progressText,
  reviewItems,
} from "@/domains/logic";
import { autoAdvances } from "@/domains/forms/auto-advance";
import { validateAnswer } from "@/domains/logic";
import { normalizeAnswer } from "@/domains/responses/queries";
import {
  formatAnswerValue,
  questionColumnLabels,
  answerCells,
  previewAnswerValue,
  consentTime,
} from "@/domains/responses/format";
import { consentVersion } from "@/domains/forms/consent-record";
import { addressFromComponents } from "@/domains/places";
import type { QuestionV1 } from "@/domains/forms/schema/v1";
/** Features 49–68 (14 Nov 2026): the parts that are plain functions. */

const text = (id: string, order: number) => ({
  id,
  type: "short_text",
  order,
  label: id,
  required: false,
  settings: {},
});

/** q1 asks "short or long?"; "short" jumps past q2–q5 to q6. */
const branching = compileFormSchema(
  parseFormSchema({
    schemaVersion: 1,
    meta: { title: "Branching" },
    theme: {},
    endings: [{ id: "end", title: "Thanks", isDefault: true }],
    questions: [
      {
        id: "q1",
        type: "single_select",
        order: 0,
        label: "Which path?",
        required: true,
        settings: {
          allowOther: false,
          options: [
            { id: "short", label: "Short" },
            { id: "long", label: "Long" },
          ],
        },
      },
      ...["q2", "q3", "q4", "q5", "q6"].map((id, i) => text(id, i + 1)),
    ],
    logic: [
      {
        id: "jump",
        questionId: "q1",
        operator: "equals",
        value: "short",
        action: { type: "jump_to_question", questionId: "q6" },
      },
    ],
  }),
);
const counted = new Set(["q1", "q2", "q3", "q4", "q5", "q6"]);

describe("progress along the way the logic goes (F-51)", () => {
  it("counts every question before the path is known", () => {
    const p = formProgress(branching, {
      currentId: "q1",
      answers: {},
      history: [],
      counted,
    });
    expect(p).toMatchObject({ current: 1, total: 6, remaining: 5, share: 0 });
    expect(progressText(p, "count")).toBe("Question 1 of 6");
    // Question 1 of 6 is unanswered too: six left (QA FC15-48).
    expect(progressText(p, "remaining")).toBe("6 questions left");
  });

  it("drops the questions a branch skips", () => {
    const p = formProgress(branching, {
      currentId: "q6",
      answers: { q1: "short" },
      history: ["q1"],
      counted,
    });
    // q2–q5 are never asked on this path: question 2 of 2, not 6 of 6.
    expect(p).toMatchObject({ current: 2, total: 2, remaining: 0, share: 0.5 });
    expect(progressText(p, "percent")).toBe("50% complete");
    expect(progressText(p, "remaining")).toBe("Last question");
  });

  it("never goes past 100%", () => {
    const p = formProgress(branching, {
      currentId: "q6",
      answers: { q1: "short" },
      history: ["q1"],
      counted,
      currentShare: 5,
    });
    expect(p.share).toBe(1);
  });

  it("says nothing when the creator chose no text", () => {
    const p = formProgress(branching, {
      currentId: "q1",
      answers: {},
      history: [],
      counted,
    });
    expect(progressText(p, "none")).toBeNull();
  });
});

describe("configurable auto-advance (F-63)", () => {
  const choice = branching.schema.questions[0];
  const typed = branching.schema.questions[1];

  it("is on for single choices unless the form or question says otherwise", () => {
    expect(autoAdvances(choice, {})).toBe(true);
    expect(autoAdvances(choice, { autoAdvance: false })).toBe(false);
    expect(autoAdvances({ ...choice, autoAdvance: true }, { autoAdvance: false })).toBe(
      true,
    );
    expect(autoAdvances({ ...choice, autoAdvance: false }, {})).toBe(false);
  });

  it("never applies to typed or multi-answer questions", () => {
    expect(autoAdvances({ ...typed, autoAdvance: true }, {})).toBe(false);
    expect(
      autoAdvances(
        {
          id: "m",
          type: "multi_select",
          order: 0,
          label: "Pick",
          required: false,
          autoAdvance: true,
          settings: { allowOther: false, options: [{ id: "a", label: "A" }] },
        },
        {},
      ),
    ).toBe(false);
  });
});

// --- date range (F-58) -------------------------------------------------------

const range = (settings: Record<string, unknown> = {}) =>
  ({
    id: "stay",
    type: "date_range",
    order: 0,
    label: "Your stay",
    required: true,
    settings: { count: "nights", ...settings },
  }) as Extract<QuestionV1, { type: "date_range" }>;

describe("date ranges (F-58)", () => {
  const ok = (q: QuestionV1, v: unknown) => validateAnswer(q, v);

  it("rejects an end before the start, and a same-day stay counted in nights", () => {
    expect(ok(range(), { start: "2026-12-10", end: "2026-12-08" })).toEqual({
      ok: false,
      message: "The end date can't be before the start date.",
    });
    expect(ok(range(), { start: "2026-12-10", end: "2026-12-10" }).ok).toBe(false);
    expect(
      ok(range({ count: "days" }), { start: "2026-12-10", end: "2026-12-10" }).ok,
    ).toBe(true);
  });

  it("counts across a month, a year and a clock change exactly", () => {
    const n = (start: string, end: string) =>
      (normalizeAnswer(range(), { start, end }) as { days: number }).days;
    expect(n("2026-12-30", "2027-01-02")).toBe(3);
    expect(n("2027-02-27", "2027-03-01")).toBe(2);
    // Europe's clocks go back on 25 Oct 2026: still one night per day.
    expect(n("2026-10-24", "2026-10-26")).toBe(2);
    expect(
      (
        normalizeAnswer(range({ count: "days" }), {
          start: "2028-02-28",
          end: "2028-03-01",
        }) as {
          days: number;
        }
      ).days,
    ).toBe(3);
  });

  it("works the length out itself, whatever the browser sent", () => {
    expect(
      normalizeAnswer(range(), { start: "2026-12-01", end: "2026-12-04", days: 99 }),
    ).toEqual({ start: "2026-12-01", end: "2026-12-04", days: 3 });
  });

  it("holds the limits: dates, length, weekdays and closed days", () => {
    const q = range({
      minDate: "2026-12-01",
      maxDate: "2026-12-31",
      minDays: 2,
      maxDays: 7,
      disabledWeekdays: [0],
      disabledDates: ["2026-12-25"],
    });
    const msg = (start: string, end: string) => {
      const r = ok(q, { start, end });
      return r.ok ? null : r.message;
    };
    expect(msg("2026-11-30", "2026-12-03")).toMatch(/on or after/);
    expect(msg("2026-12-29", "2027-01-02")).toMatch(/on or before/);
    expect(msg("2026-12-01", "2026-12-02")).toBe("Choose at least 2 nights.");
    expect(msg("2026-12-01", "2026-12-10")).toBe("Choose at most 7 nights.");
    expect(msg("2026-12-06", "2026-12-08")).toBe("The start date can't be a Sunday.");
    expect(msg("2026-12-23", "2026-12-25")).toMatch(/isn't available/);
    expect(msg("2026-12-01", "2026-12-04")).toBeNull();
    expect(msg("2026-02-30", "2026-12-04")).toBe("Choose a start and an end date.");
  });

  it("exports the dates and the length in their own columns", () => {
    const q = range();
    const value = normalizeAnswer(q, { start: "2026-12-01", end: "2026-12-04" });
    expect(questionColumnLabels(q)).toEqual([
      "Your stay (Start)",
      "Your stay (End)",
      "Your stay (Nights)",
    ]);
    expect(answerCells(q, q, value)).toEqual(["2026-12-01", "2026-12-04", "3"]);
    expect(formatAnswerValue(q, value)).toBe("2026-12-01 – 2026-12-04 (3 nights)");
  });
});

// --- consent (F-62) ----------------------------------------------------------

const consent = (settings: Record<string, unknown> = {}, required = true) =>
  ({
    id: "notice",
    type: "consent",
    order: 0,
    label: "Before you start",
    required,
    settings: {
      content: "We keep your answers for a year.",
      acknowledgeLabel: "I accept",
      ...settings,
    },
  }) as Extract<QuestionV1, { type: "consent" }>;

describe("consent pages (F-62)", () => {
  it("won't go on until the box is ticked, when required", () => {
    expect(validateAnswer(consent(), undefined).ok).toBe(false);
    expect(validateAnswer(consent(), { acknowledged: false }).ok).toBe(false);
    expect(validateAnswer(consent(), { acknowledged: true }).ok).toBe(true);
    // Not required: may be left unticked.
    expect(validateAnswer(consent({}, false), { acknowledged: false }).ok).toBe(true);
  });

  it("never needs the opt-in", () => {
    const q = consent({ optInLabel: "Email me news" });
    expect(validateAnswer(q, { acknowledged: true, optIn: false }).ok).toBe(true);
  });

  it("records which notice and when, from the server, not the browser", () => {
    const q = consent({ optInLabel: "Email me news", versionLabel: "v3" });
    const stored = normalizeAnswer(q, {
      acknowledged: true,
      optIn: true,
      version: "forged",
      acceptedAt: "1999-01-01T00:00:00.000Z",
    }) as Record<string, unknown>;
    expect(stored).toMatchObject({
      acknowledged: true,
      optIn: true,
      version: consentVersion(q),
      versionLabel: "v3",
    });
    expect(stored.acceptedAt).not.toBe("1999-01-01T00:00:00.000Z");
    expect(Date.parse(stored.acceptedAt as string)).toBeGreaterThan(Date.now() - 60_000);
  });

  it("gives a new version when a word of the notice changes", () => {
    expect(consentVersion(consent())).toBe(consentVersion(consent()));
    expect(consentVersion(consent())).not.toBe(
      consentVersion(consent({ content: "We keep your answers for two years." })),
    );
  });

  it("exports what was ticked, the version and the time", () => {
    const q = consent({ optInLabel: "Email me news", versionLabel: "v3" });
    const stored = normalizeAnswer(q, { acknowledged: true, optIn: false });
    expect(questionColumnLabels(q)).toEqual([
      "Before you start (Accepted)",
      "Before you start (Opt-in)",
      "Before you start (Notice version)",
      "Before you start (Accepted at)",
    ]);
    const cells = answerCells(q, q, stored);
    expect(cells.slice(0, 3)).toEqual(["Yes", "No", `v3 · ${consentVersion(q)}`]);
    expect(cells[3]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// --- review before submitting (F-60) -------------------------------------------

describe("editing from the review (F-60)", () => {
  const shownShort = new Set(["q1", "q6"]);

  it("goes back to the review when the new path is all answered", () => {
    const after = afterReviewEdit(branching, { q1: "short", q6: "x" }, shownShort);
    expect(after).toEqual({ kind: "review", path: ["q1", "q6"], endingId: "end" });
  });

  it("asks the questions a changed branch now leads to", () => {
    // "short" → "long": q2–q5 are on the way now, and were never shown.
    const after = afterReviewEdit(branching, { q1: "long", q6: "x" }, shownShort);
    expect(after).toEqual({ kind: "ask", questionId: "q2", history: ["q1"] });
  });

  it("stops at a required question that's now empty or invalid", () => {
    const required = compileFormSchema(
      parseFormSchema({
        ...branching.schema,
        questions: branching.schema.questions.map((q) =>
          q.id === "q6" ? { ...q, required: true } : q,
        ),
      }),
    );
    const after = afterReviewEdit(required, { q1: "short" }, shownShort);
    expect(after).toMatchObject({ kind: "ask", questionId: "q6" });
  });

  it("lists answerable questions on the path, under their sections", () => {
    const withSections = compileFormSchema(
      parseFormSchema({
        ...branching.schema,
        questions: [
          ...branching.schema.questions.map((q) => ({ ...q, order: q.order * 2 + 2 })),
          {
            id: "pb",
            type: "page_break",
            order: 7,
            label: "About you",
            required: false,
            settings: {},
          },
        ],
      }),
    );
    const items = reviewItems(withSections, ["q1", "q2", "q3", "q4", "q5", "q6"]);
    expect(items.map((i) => [i.question.id, i.section])).toEqual([
      ["q1", null],
      ["q2", null],
      ["q3", null],
      ["q4", "About you"],
      ["q5", "About you"],
      ["q6", "About you"],
    ]);
  });
});

// --- repeatable groups (F-56) ---------------------------------------------------

const group = (settings: Record<string, unknown> = {}) =>
  parseFormSchema({
    schemaVersion: 1,
    meta: { title: "Guests" },
    theme: {},
    endings: [{ id: "end", title: "Thanks", isDefault: true }],
    questions: [
      {
        id: "guests",
        type: "repeat_group",
        order: 0,
        label: "Guests",
        required: true,
        settings: {
          entryLabel: "Guest",
          minEntries: 1,
          maxEntries: 3,
          fields: [
            { id: "name", type: "short_text", label: "Name", required: true },
            { id: "child", type: "yes_no", label: "Under 12?", required: false },
            {
              id: "age",
              type: "number",
              label: "Age",
              required: true,
              showIf: { fieldId: "child", op: "equals", value: true },
            },
            { id: "email", type: "email", label: "Email", required: false },
            { id: "phone", type: "phone", label: "Phone", required: false },
          ],
          ...settings,
        },
      },
    ],
    logic: [],
  }).questions[0] as Extract<QuestionV1, { type: "repeat_group" }>;

describe("repeatable groups (F-56)", () => {
  const msg = (value: unknown, q = group()) => {
    const r = validateAnswer(q, value);
    return r.ok ? null : r.message;
  };

  it("names the entry and the field that's wrong", () => {
    expect(
      msg([
        { id: "e1", values: { name: "Ada" } },
        { id: "e2", values: { name: "Bo", email: "not-an-email" } },
      ]),
    ).toBe("Guest 2: Email: Enter a valid email address.");
  });

  it("applies a field's condition within its own entry only", () => {
    // Entry 1 is a child, so Age is asked there; entry 2 isn't.
    expect(
      msg([
        { id: "e1", values: { name: "Ada", child: true } },
        { id: "e2", values: { name: "Bo", child: false } },
      ]),
    ).toBe("Guest 1: Age: This question requires an answer.");
    expect(
      msg([
        { id: "e1", values: { name: "Ada", child: true, age: 7 } },
        { id: "e2", values: { name: "Bo", child: false } },
      ]),
    ).toBeNull();
  });

  it("holds the fewest and most entries; blank ones don't count", () => {
    const q = group({ minEntries: 2 });
    expect(
      msg(
        [
          { id: "e1", values: { name: "Ada" } },
          { id: "e2", values: {} },
        ],
        q,
      ),
    ).toBe("Add at least 2 guests.");
    expect(
      msg(
        ["a", "b", "c", "d"].map((id) => ({ id, values: { name: id } })),
        group(),
      ),
    ).toBe("Add at most 3 guests.");
  });

  it("refuses fields the group doesn't have, and repeated entry ids", () => {
    expect(msg([{ id: "e1", values: { name: "Ada", isAdmin: true } }])).toMatch(
      /check this entry/,
    );
    expect(
      msg([
        { id: "e1", values: { name: "Ada" } },
        { id: "e1", values: { name: "Bo" } },
      ]),
    ).not.toBeNull();
  });

  it("is stored in order, cleaned like the fields' own types", () => {
    const stored = normalizeAnswer(group(), [
      {
        id: "e1",
        values: { name: "Ada", child: false, age: 40, phone: "+1 415 555 2671" },
      },
      { id: "e2", values: {} },
      { id: "e3", values: { name: "Bo" } },
    ]);
    // The blank entry is dropped; Age is dropped where its condition hides it.
    expect(stored).toEqual([
      { id: "e1", values: { name: "Ada", child: false, phone: "+14155552671" } },
      { id: "e3", values: { name: "Bo" } },
    ]);
  });

  it("exports one column per field, one line per entry", () => {
    const q = group();
    const value = [
      { id: "e1", values: { name: "Ada", child: true, age: 7 } },
      { id: "e2", values: { name: "Bo", email: "bo@example.com" } },
    ];
    expect(questionColumnLabels(q)).toEqual([
      "Guests (Name)",
      "Guests (Under 12?)",
      "Guests (Age)",
      "Guests (Email)",
      "Guests (Phone)",
    ]);
    expect(answerCells(q, q, value)).toEqual([
      "Ada\nBo",
      "Yes\n",
      "7\n",
      "\nbo@example.com",
      "\n",
    ]);
    expect(formatAnswerValue(q, value)).toBe(
      "Guest 1: Name: Ada; Under 12?: Yes; Age: 7\nGuest 2: Name: Bo; Email: bo@example.com",
    );
  });
});

// --- address suggestions (F-65) --------------------------------------------------

describe("Google Places address parts (F-65)", () => {
  it("fill the form's fields from Google's components", () => {
    expect(
      addressFromComponents([
        { longText: "1600", types: ["street_number"] },
        { longText: "Amphitheatre Parkway", types: ["route"] },
        { longText: "Mountain View", types: ["locality", "political"] },
        {
          longText: "California",
          shortText: "CA",
          types: ["administrative_area_level_1"],
        },
        { longText: "94043", types: ["postal_code"] },
        { longText: "United States", shortText: "US", types: ["country"] },
      ]),
    ).toEqual({
      line1: "1600 Amphitheatre Parkway",
      city: "Mountain View",
      state: "California",
      postalCode: "94043",
      country: "United States",
    });
  });

  it("use the post town where there's no locality, and keep a flat as line 2", () => {
    expect(
      addressFromComponents([
        { longText: "Flat 3", types: ["subpremise"] },
        { longText: "10", types: ["street_number"] },
        { longText: "Downing Street", types: ["route"] },
        { longText: "London", types: ["postal_town"] },
        { longText: "SW1A 2AA", types: ["postal_code"] },
        { longText: "United Kingdom", types: ["country"] },
      ]),
    ).toEqual({
      line1: "10 Downing Street",
      line2: "Flat 3",
      city: "London",
      postalCode: "SW1A 2AA",
      country: "United Kingdom",
    });
  });
});

describe("consent and address in the responses table (QA FC11-10, run 14)", () => {
  it("shows the outcome and notice; the time is left to the viewer's clock", () => {
    const value = {
      acknowledged: true,
      version: "abc123",
      versionLabel: "Privacy v3",
      acceptedAt: "2026-11-20T10:13:42.000Z",
    };
    expect(previewAnswerValue(consent(), value)).toBe("Accepted · Privacy v3");
    expect(consentTime(consent(), value)).toBe("2026-11-20T10:13:42.000Z");
    expect(consentTime(consent(), { ...value, acceptedAt: "soon" })).toBeNull();
  });

  it("puts an address on lines, like an envelope", () => {
    const address = {
      id: "addr",
      type: "address",
      order: 0,
      label: "Address",
      required: false,
      settings: {
        fields: ["line1", "line2", "city", "state", "postalCode", "country"],
        requiredFields: [],
      },
    } as unknown as QuestionV1;
    expect(
      previewAnswerValue(address, {
        line1: "1600 Amphitheatre Pkwy",
        city: "Mountain View",
        state: "CA",
        postalCode: "94043",
        country: "US",
      }),
    ).toBe("1600 Amphitheatre Pkwy\nMountain View, CA, 94043\nUS");
    expect(previewAnswerValue(address, { city: "Pune" })).toBe("Pune");
  });
});
