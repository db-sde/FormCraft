// @vitest-environment node
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { nextStepFor, walkForm } from "@/domains/logic";
import { syntheticForm } from "../support/synthetic-form";

/**
 * Performance budgets for the logic engine (spec phase 36), at the
 * largest forms the schema allows (200 questions, 500 rules). Measured
 * numbers are in docs/logic-engine.md (`npm run bench:logic`); the
 * budgets here are ~25–50× looser so a slow CI machine never trips
 * them, while an accidental quadratic or exponential change does.
 */
const best = (run: () => void, times = 5) => {
  run();
  let min = Infinity;
  for (let i = 0; i < times; i += 1) {
    const start = performance.now();
    run();
    min = Math.min(min, performance.now() - start);
  }
  return min;
};

describe("logic engine performance", () => {
  for (const [questions, rulesPerQuestion] of [
    [200, 1],
    [100, 5],
  ] as const) {
    const label = `${questions} questions, ${questions * rulesPerQuestion} rules`;
    const { compiled, answers } = syntheticForm(questions, rulesPerQuestion);
    const path = walkForm(compiled, answers).visitedQuestionIds;

    it(`${label}: the walk reaches the end and scores every step`, () => {
      const result = walkForm(compiled, answers);
      expect(result.endingId).toBe("end");
      // Every tenth question jumps over one, so most are visited.
      expect(path.length).toBeGreaterThan(questions * 0.85);
      expect(result.variables.v_score).toBe(path.length);
      expect(result.validationErrors).toEqual([]);
    });

    it(`${label}: a submission's walk stays under 25 ms`, () => {
      expect(best(() => walkForm(compiled, answers))).toBeLessThan(25);
    });

    it(`${label}: the slowest single step stays under 25 ms`, () => {
      expect(best(() => nextStepFor(compiled, answers, path))).toBeLessThan(25);
    });

    it(`${label}: a whole session of steps stays under 1 s`, () => {
      expect(
        best(() => {
          for (let i = 1; i <= path.length; i += 1)
            nextStepFor(compiled, answers, path.slice(0, i));
        }, 2),
      ).toBeLessThan(1000);
    });

    it(`${label}: replaying 500 responses stays under 5 s`, () => {
      expect(
        best(() => {
          for (let i = 0; i < 500; i += 1) walkForm(compiled, answers);
        }, 1),
      ).toBeLessThan(5000);
    });
  }
});
