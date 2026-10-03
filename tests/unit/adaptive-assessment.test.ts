import { describe, expect, it } from "vitest";
import { analyzeLogic, compileFormSchema, parseFormSchema } from "@/domains/forms/schema";
import { removeQuestionReferences } from "@/domains/forms/references";
import { adaptiveSequence, isAnswerCorrect } from "@/domains/logic/adaptive";
import { nextStepFor, firstQuestionId, walkForm } from "@/domains/logic";

/** Adaptive assessments (logic spec phase 20). */
const quiz = (id: string, order: number, extra: Record<string, unknown> = {}) => ({
  id,
  type: "single_select",
  order,
  label: id.toUpperCase(),
  required: true,
  settings: {
    allowOther: false,
    options: [
      {
        id: `${id}_right`,
        label: "Right",
        correct: true,
        scores: [{ variableId: "v", points: 1 }],
      },
      { id: `${id}_wrong`, label: "Wrong" },
    ],
  },
  ...extra,
});
const text = (id: string, order: number) => ({
  id,
  type: "short_text",
  order,
  label: id,
  required: false,
  settings: {},
});

// Levels: e1 e2 (1) · m1 m2 (3) · h1 h2 (5), deliberately out of order in
// the form so "next" sometimes sits earlier than the current question.
const input = {
  schemaVersion: 1,
  meta: { title: "Adaptive quiz" },
  theme: {},
  endings: [{ id: "end", title: "Done", isDefault: true }],
  variables: [{ id: "v", name: "score", type: "number" }],
  questions: [
    text("intro", 0),
    quiz("h1", 1),
    quiz("e1", 2),
    quiz("m1", 3),
    quiz("h2", 4),
    quiz("m2", 5),
    quiz("e2", 6),
    text("outro", 7),
  ],
  logic: [],
  pools: [
    {
      id: "bank",
      name: "Bank",
      questionIds: ["h1", "e1", "m1", "h2", "m2", "e2"],
      pick: 3,
      adaptive: { start: 3, levels: { e1: 1, e2: 1, m1: 3, m2: 3, h1: 5, h2: 5 } },
    },
  ],
};
const schema = parseFormSchema(input);
const compiled = compileFormSchema(schema);
const questions = new Map(schema.questions.map((q) => [q.id, q]));
const pool = schema.pools![0];
const level = (id: string) => pool.adaptive!.levels[id];
const right = (id: string) => `${id}_right`;
const wrong = (id: string) => `${id}_wrong`;

/** Answers the form step by step, as the browser does. */
function play(seed: string, answer: (questionId: string) => unknown) {
  const answers: Record<string, unknown> = {};
  const path: string[] = [];
  let current = firstQuestionId(compiled, answers, { seed });
  while (current) {
    path.push(current);
    answers[current] = answer(current);
    const { next } = nextStepFor(compiled, answers, path, { seed });
    current = next.type === "question" ? next.questionId : null;
  }
  return { answers, path };
}

describe("grading", () => {
  it("is right only when exactly the marked options are chosen", () => {
    const q = questions.get("m1")!;
    expect(isAnswerCorrect(q, "m1_right")).toBe(true);
    expect(isAnswerCorrect(q, "m1_wrong")).toBe(false);
    expect(isAnswerCorrect(q, undefined)).toBe(false);
    expect(isAnswerCorrect(questions.get("intro")!, "anything")).toBeNull();
    const multi = parseFormSchema({
      ...input,
      pools: undefined,
      questions: [
        {
          id: "m",
          type: "multi_select",
          order: 0,
          label: "M",
          settings: {
            allowOther: false,
            options: [
              { id: "a", label: "A", correct: true },
              { id: "b", label: "B", correct: true },
              { id: "c", label: "C" },
            ],
          },
        },
      ],
    }).questions[0];
    expect(isAnswerCorrect(multi, ["b", "a"])).toBe(true);
    expect(isAnswerCorrect(multi, ["a"])).toBe(false);
    expect(isAnswerCorrect(multi, ["a", "b", "c"])).toBe(false);
  });
});

describe("the adaptive sequence", () => {
  it("starts at the starting level and waits for an answer", () => {
    const { asked, complete } = adaptiveSequence(pool, questions, {}, "seed-1");
    expect(asked).toHaveLength(1);
    expect(level(asked[0])).toBe(3);
    expect(complete).toBe(false);
  });

  it("gets harder after right answers and easier after wrong ones", () => {
    const allRight = play("seed-1", right);
    const asked = allRight.path.filter((id) => pool.questionIds.includes(id));
    expect(asked.map(level)).toEqual([3, 3, 5]);
    // Level 3 → right → target 4: the nearest are 3 and 5, and a tie goes
    // to the easier one; right again → target 5.

    // Wrong → target 2: levels 1 and 3 are equally near, the easier wins.
    const allWrong = play("seed-1", wrong);
    expect(
      allWrong.path.filter((id) => pool.questionIds.includes(id)).map(level),
    ).toEqual([3, 1, 1]);

    // Right then wrong comes back to the middle… which is used up, so
    // the nearest left is taken.
    let n = 0;
    const mixed = play("seed-1", (id) =>
      pool.questionIds.includes(id) ? (n++ === 0 ? right(id) : wrong(id)) : "x",
    );
    const mixedAsked = mixed.path.filter((id) => pool.questionIds.includes(id));
    expect(mixedAsked).toHaveLength(3);
    expect(new Set(mixedAsked).size).toBe(3);
  });

  it("asks exactly `pick`, then carries on after the group", () => {
    const { path } = play("seed-2", right);
    expect(path[0]).toBe("intro");
    expect(path[path.length - 1]).toBe("outro");
    expect(path).toHaveLength(5);
  });

  it("varies which question is asked between respondents, not the levels", () => {
    const firsts = new Set(
      Array.from(
        { length: 40 },
        (_, i) => adaptiveSequence(pool, questions, {}, `s${i}`).asked[0],
      ),
    );
    expect([...firsts].sort()).toEqual(["m1", "m2"]);
  });
});

describe("browser and server agree", () => {
  it("for every seed and answer pattern, the walk visits the path that was played", () => {
    for (let s = 0; s < 25; s += 1) {
      for (let pattern = 0; pattern < 8; pattern += 1) {
        let n = 0;
        const seed = `seed-${s}`;
        const { answers, path } = play(seed, (id) =>
          pool.questionIds.includes(id)
            ? (pattern >> n++) & 1
              ? right(id)
              : wrong(id)
            : "x",
        );
        const walk = walkForm(compiled, answers, { seed });
        expect(walk.visitedQuestionIds).toEqual(path);
        // Score = right answers among the questions actually asked.
        const rights = path.filter((id) => answers[id] === right(id)).length;
        expect(walk.variables.v).toBe(rights);
        expect(walk.validationErrors).toEqual([]);
      }
    }
  });

  it("ignores answers the client sends for questions it wasn't asked", () => {
    const seed = "seed-3";
    const { answers, path } = play(seed, right);
    const stuffed = { ...answers };
    for (const id of pool.questionIds) stuffed[id] ??= right(id);
    const walk = walkForm(compiled, stuffed, { seed });
    // Extra right answers can't add questions beyond `pick` or points.
    expect(
      walk.visitedQuestionIds.filter((id) => pool.questionIds.includes(id)),
    ).toHaveLength(3);
    expect(walk.variables.v).toBe(3);
    expect(walk.visitedQuestionIds).toHaveLength(path.length);
  });

  it("re-plans when an earlier answer is changed", () => {
    const seed = "seed-4";
    const { answers, path } = play(seed, right);
    const first = path[1];
    const changed = { ...answers, [first]: wrong(first) };
    const walk = walkForm(compiled, changed, { seed });
    const asked = walk.visitedQuestionIds.filter((id) => pool.questionIds.includes(id));
    // The second question is now an easy one the respondent never saw.
    // The walk puts it on the path with no answer, so the server's
    // required check refuses the submission instead of scoring a stale
    // path.
    expect(asked[0]).toBe(first);
    expect(asked).toHaveLength(2);
    expect(level(asked[1])).toBe(1);
    expect(answers[asked[1]]).toBeUndefined();
  });
});

describe("analysis and editing", () => {
  it("warns about ungraded questions and a group with one level", () => {
    const flat = parseFormSchema({
      ...input,
      questions: [...input.questions.slice(0, 7), text("free", 7), text("outro", 8)],
      pools: [
        {
          id: "bank",
          questionIds: ["m1", "m2", "free"],
          pick: 2,
          adaptive: { start: 3, levels: {} },
        },
      ],
    });
    const codes = analyzeLogic(flat).map((i) => i.code);
    expect(codes).toContain("adaptive_ungraded");
    expect(codes).toContain("adaptive_one_level");
    expect(analyzeLogic(schema).filter((i) => i.code.startsWith("adaptive"))).toEqual([]);
  });

  it("forgets a deleted question's level", () => {
    const next = removeQuestionReferences(schema, "h1");
    expect(next.pools![0].questionIds).not.toContain("h1");
    expect(next.pools![0].adaptive!.levels).not.toHaveProperty("h1");
  });
});
