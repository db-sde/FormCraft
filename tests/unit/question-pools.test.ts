import { describe, expect, it } from "vitest";
import { analyzeLogic, compileFormSchema, parseFormSchema } from "@/domains/forms/schema";
import { removeQuestionReferences } from "@/domains/forms/references";
import {
  questionsLeftOut,
  seededShuffle,
  newSeed,
  SEED_PATTERN,
} from "@/domains/logic/random";
import { walkForm } from "@/domains/logic";

const q = (id: string, order: number) => ({
  id,
  type: "short_text",
  order,
  label: id.toUpperCase(),
  required: true,
  settings: {},
});

const schema = parseFormSchema({
  schemaVersion: 1,
  meta: { title: "Quiz" },
  theme: {},
  endings: [{ id: "end", title: "Done", isDefault: true }],
  questions: [q("intro", 0), q("a", 1), q("b", 2), q("c", 3), q("d", 4), q("outro", 5)],
  logic: [],
  pools: [
    { id: "bank", name: "Question bank", questionIds: ["a", "b", "c", "d"], pick: 2 },
  ],
});

describe("seeded randomness", () => {
  it("is deterministic per seed and a permutation", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(seededShuffle(items, "seed-one")).toEqual(seededShuffle(items, "seed-one"));
    expect([...seededShuffle(items, "seed-one")].sort()).toEqual(items);
    // Different seeds give different orders (not guaranteed for any one
    // pair, but across many it must vary).
    const orders = new Set(
      Array.from({ length: 30 }, (_, i) => seededShuffle(items, `s${i}`).join()),
    );
    expect(orders.size).toBeGreaterThan(20);
  });

  it("makes seeds the server accepts", () => {
    for (let i = 0; i < 20; i += 1) expect(newSeed()).toMatch(SEED_PATTERN);
  });

  it("picks exactly `pick` from each pool, spread across seeds", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 400; i += 1) {
      const out = questionsLeftOut(schema, `seed-${i}`);
      expect(out.size).toBe(2);
      for (const id of ["a", "b", "c", "d"]) {
        if (!out.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    // Each question is asked roughly half the time.
    for (const id of ["a", "b", "c", "d"]) {
      expect(counts.get(id)).toBeGreaterThan(150);
      expect(counts.get(id)).toBeLessThan(250);
    }
  });
});

describe("the engine with pools", () => {
  it("asks only the picked questions, and never requires the others", () => {
    const compiled = compileFormSchema(schema);
    const seed = "fixed-seed-1";
    const leftOut = questionsLeftOut(schema, seed);
    const asked = ["a", "b", "c", "d"].filter((id) => !leftOut.has(id));
    const answers = Object.fromEntries(
      ["intro", ...asked, "outro"].map((id) => [id, "x"]),
    );
    const walk = walkForm(compiled, answers, { seed });
    expect(walk.visitedQuestionIds).toEqual(["intro", ...asked, "outro"]);
    expect(
      walk.trace
        .filter((t) => t.kind === "question_skipped")
        .map((t) => [t.questionId, t.reason]),
    ).toEqual([...leftOut].sort().map((id) => [id, "pool"]));
  });

  it("asks the same questions for the same seed, every time", () => {
    const compiled = compileFormSchema(schema);
    const a = walkForm(compiled, {}, { seed: "same-seed" }).visitedQuestionIds;
    const b = walkForm(compiled, {}, { seed: "same-seed" }).visitedQuestionIds;
    expect(a).toEqual(b);
  });
});

describe("pools in the analyser and on delete", () => {
  it("flags groups that can't work", () => {
    const codes = (pools: unknown) =>
      analyzeLogic(parseFormSchema({ ...schema, pools })).map((i) => i.code);
    expect(codes([{ id: "p", questionIds: ["a", "b"], pick: 2 }])).toContain(
      "pool_pick_too_many",
    );
    expect(codes([{ id: "p", questionIds: ["a", "gone"], pick: 1 }])).toContain(
      "pool_missing_question",
    );
    expect(
      codes([
        { id: "p", questionIds: ["a", "b"], pick: 1 },
        { id: "r", questionIds: ["b", "c"], pick: 1 },
      ]),
    ).toContain("pool_overlap");
    expect(codes(schema.pools)).toEqual([]);
  });

  it("drops a deleted question from its group, shrinking or removing the group", () => {
    const one = removeQuestionReferences(schema, "a");
    expect(one.pools).toEqual([
      { id: "bank", name: "Question bank", questionIds: ["b", "c", "d"], pick: 2 },
    ]);
    const two = removeQuestionReferences(one, "b");
    expect(two.pools?.[0]).toMatchObject({ questionIds: ["c", "d"], pick: 1 });
    expect(removeQuestionReferences(two, "c").pools).toEqual([]);
  });
});

describe("rules on a pool question that wasn't drawn (QA FC4-07)", () => {
  // Pool r1–r3, ask 2; the ending rule hangs off r3. Runs that don't draw
  // r3 must still reach that ending.
  const withRule = parseFormSchema({
    schemaVersion: 1,
    meta: { title: "Quiz" },
    theme: {},
    endings: [
      { id: "none", title: "None", isDefault: true },
      { id: "both", title: "Both" },
    ],
    questions: [q("intro", 0), q("r1", 1), q("r2", 2), q("r3", 3)],
    logic: [],
    pools: [{ id: "p", name: "Pool", questionIds: ["r1", "r2", "r3"], pick: 2 }],
    rules: [
      {
        id: "after_r3",
        on: { event: "question_answered", questionId: "r3" },
        when: {
          type: "compare",
          left: { type: "answer", questionId: "intro" },
          op: "eq",
          right: { type: "literal", value: "yes" },
        },
        then: [{ type: "jump_to_ending", endingId: "both" }],
      },
    ],
  });
  const compiled = compileFormSchema(withRule);
  const seeds = Array.from({ length: 60 }, (_, i) => `pool-seed-${i}`);
  const drawsR3 = (seed: string) => !questionsLeftOut(withRule, seed).has("r3");
  const answersFor = (seed: string, intro: string) => {
    const asked = ["r1", "r2", "r3"].filter(
      (id) => !questionsLeftOut(withRule, seed).has(id),
    );
    return Object.fromEntries([["intro", intro], ...asked.map((id) => [id, "x"])]);
  };

  it("reaches the rule's ending whether or not r3 was drawn", () => {
    const skipped = seeds.filter((s) => !drawsR3(s));
    const drawn = seeds.filter(drawsR3);
    expect(skipped.length).toBeGreaterThan(5);
    expect(drawn.length).toBeGreaterThan(5);
    for (const seed of seeds) {
      const walk = walkForm(compiled, answersFor(seed, "yes"), { seed });
      expect(walk.endingId, seed).toBe("both");
      expect(walk.visitedQuestionIds).not.toContain(drawsR3(seed) ? "nothing" : "r3");
    }
  });

  it("still uses the default ending when the rule doesn't match", () => {
    for (const seed of seeds) {
      expect(walkForm(compiled, answersFor(seed, "no"), { seed }).endingId).toBe("none");
    }
  });
});
