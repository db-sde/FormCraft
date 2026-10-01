import { describe, expect, it } from "vitest";
import {
  compileFormSchema,
  FormSchemaError,
  parseFormSchema,
  validateSemantics,
} from "@/domains/forms/schema";
import type { CompiledFormV1 } from "@/domains/forms/schema";
import { evaluateNextStep, walkForm, type AnswerMap } from "@/domains/logic";

/**
 * Property tests for the logic engine: instead of a handful of
 * hand-picked forms, generate thousands of random ones (from a fixed
 * seed, so a failure reproduces) and check what must hold for ALL of
 * them — chiefly that no respondent can ever be sent round in a circle,
 * and that the browser's step-by-step walk and the server's whole-form
 * walk agree on the path and the ending.
 */

/** Small, fast, seedable PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)],
    chance: (p: number) => next() < p,
  };
}
type Rng = ReturnType<typeof rng>;

const TYPES = ["short_text", "number", "single_select", "yes_no"] as const;
const OPTIONS = ["opt_a", "opt_b", "opt_c"];
const OPERATORS: Record<(typeof TYPES)[number], string[]> = {
  short_text: ["is_answered", "is_not_answered", "equals", "not_equals"],
  number: ["is_answered", "is_not_answered", "equals", "gt", "lt"],
  single_select: ["is_answered", "is_not_answered", "equals", "not_equals", "contains"],
  yes_no: ["is_answered", "is_not_answered", "equals", "not_equals"],
};

function randomValue(type: (typeof TYPES)[number], r: Rng): unknown {
  switch (type) {
    case "number":
      return r.int(5);
    case "single_select":
      return r.pick(OPTIONS);
    case "yes_no":
      return r.chance(0.5);
    default:
      return r.pick(["x", "y", ""]);
  }
}

/** A random form. `forwardOnly` mirrors what the builder allows; without
 * it, jumps may go anywhere — the shape of forms published before that
 * rule existed. */
function randomForm(r: Rng, forwardOnly: boolean) {
  const count = 1 + r.int(8);
  const questions = Array.from({ length: count }, (_, i) => {
    const type = r.pick(TYPES);
    return {
      id: `q${i}`,
      type,
      order: i,
      label: `Question ${i}`,
      required: false,
      settings:
        type === "single_select"
          ? { options: OPTIONS.map((id) => ({ id, label: id })) }
          : {},
    };
  });

  const logic = Array.from({ length: r.int(8) }, (_, i) => {
    const sourceIndex = r.int(count);
    const source = questions[sourceIndex];
    const targets = forwardOnly ? questions.slice(sourceIndex + 1) : questions; // anything, including itself and earlier questions
    const jumpToQuestion = targets.length > 0 && r.chance(0.75);
    return {
      id: `r${i}`,
      questionId: source.id,
      operator: r.pick(OPERATORS[source.type]),
      value: randomValue(source.type, r),
      action: jumpToQuestion
        ? { type: "jump_to_question", questionId: r.pick(targets).id }
        : { type: "jump_to_ending", endingId: r.pick(["end_a", "end_b"]) },
    };
  });

  return {
    schemaVersion: 1,
    meta: { title: "Random" },
    theme: {},
    endings: [
      { id: "end_a", title: "A", isDefault: true },
      { id: "end_b", title: "B", isDefault: false },
    ],
    questions,
    logic,
  };
}

function randomAnswers(form: ReturnType<typeof randomForm>, r: Rng): AnswerMap {
  const answers: AnswerMap = {};
  for (const q of form.questions) {
    if (r.chance(0.2)) continue; // left unanswered
    answers[q.id] = randomValue(q.type, r);
  }
  return answers;
}

/** What the browser does: one step at a time, remembering what it has
 * already shown. */
function stepThrough(compiled: CompiledFormV1, answers: AnswerMap) {
  const history: string[] = [];
  let current = compiled.orderedQuestionIds[0];
  const limit = compiled.orderedQuestionIds.length + 1;
  for (;;) {
    const next = evaluateNextStep(
      compiled,
      current,
      answers,
      new Set([...history, current]),
    );
    history.push(current);
    if (next.type === "ending") return { path: history, endingId: next.endingId };
    if (history.length > limit) throw new Error(`walked ${history.join(" > ")}`);
    current = next.questionId;
  }
}

const FORMS_PER_SEED = 400;
const ANSWER_SETS = 4;

describe("logic engine properties", () => {
  for (const seed of [1, 2, 3, 42, 2026]) {
    it(`forward-only forms always validate, compile and finish in order (seed ${seed})`, () => {
      const r = rng(seed);
      for (let n = 0; n < FORMS_PER_SEED; n += 1) {
        const form = randomForm(r, true);
        const parsed = parseFormSchema(form);
        expect(() => validateSemantics(parsed), `seed ${seed} form ${n}`).not.toThrow();
        const compiled = compileFormSchema(parsed);

        for (let a = 0; a < ANSWER_SETS; a += 1) {
          const answers = randomAnswers(form, r);
          const walk = walkForm(compiled, answers);
          const positions = walk.visitedQuestionIds.map((id) =>
            compiled.orderedQuestionIds.indexOf(id),
          );
          // Strictly forward: each question is shown at most once, and
          // never after one that comes later.
          expect(positions, `seed ${seed} form ${n}`).toEqual(
            [...positions].sort((x, y) => x - y),
          );
          expect(new Set(positions).size).toBe(positions.length);
          expect(stepThrough(compiled, answers)).toEqual({
            path: walk.visitedQuestionIds,
            endingId: walk.endingId,
          });
        }
      }
    });

    it(`forms published with backward jumps still can't trap a respondent (seed ${seed})`, () => {
      const r = rng(seed);
      let compiledCount = 0;
      for (let n = 0; n < FORMS_PER_SEED; n += 1) {
        const form = randomForm(r, false);
        let compiled: CompiledFormV1;
        try {
          compiled = compileFormSchema(parseFormSchema(form));
        } catch (error) {
          // The only thing the compiler may refuse is a genuine dead end.
          expect(error).toBeInstanceOf(FormSchemaError);
          continue;
        }
        compiledCount += 1;

        for (let a = 0; a < ANSWER_SETS; a += 1) {
          const answers = randomAnswers(form, r);
          const walk = walkForm(compiled, answers);
          const limit = compiled.orderedQuestionIds.length;
          expect(walk.visitedQuestionIds.length).toBeLessThanOrEqual(limit);
          expect(new Set(walk.visitedQuestionIds).size).toBe(
            walk.visitedQuestionIds.length,
          );
          expect(["end_a", "end_b"]).toContain(walk.endingId);
          // Browser and server agree even on these forms.
          expect(stepThrough(compiled, answers), `seed ${seed} form ${n}`).toEqual({
            path: walk.visitedQuestionIds,
            endingId: walk.endingId,
          });
        }
      }
      // Guard against the generator quietly producing nothing testable.
      expect(compiledCount).toBeGreaterThan(FORMS_PER_SEED / 2);
    });
  }
});
