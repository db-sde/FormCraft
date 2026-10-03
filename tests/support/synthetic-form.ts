import { compileFormSchema, parseFormSchema } from "@/domains/forms/schema";
import type { CompiledFormV1 } from "@/domains/forms/schema";

/**
 * A form of a given size for the logic-engine benchmarks (spec phase
 * 36): `questions` single-choice questions with scored options, and one
 * rule per question (`rulesPerQuestion` of them) that compares the
 * answer and a running total and adds to it. Every tenth question's
 * first rule also jumps one question ahead, so paths aren't trivial.
 * Returns the compiled form and a full set of answers.
 */
export function syntheticForm(
  questions: number,
  rulesPerQuestion = 1,
): { compiled: CompiledFormV1; answers: Record<string, string> } {
  const answers: Record<string, string> = {};
  const qs = Array.from({ length: questions }, (_, i) => {
    answers[`q${i}`] = `q${i}_b`;
    return {
      id: `q${i}`,
      type: "single_select",
      order: i,
      label: `Question ${i}`,
      required: true,
      settings: {
        allowOther: false,
        options: ["a", "b", "c", "d"].map((o, n) => ({
          id: `q${i}_${o}`,
          label: `Option ${o}`,
          scores: [{ variableId: "v_score", points: n }],
        })),
      },
    };
  });
  const rules = qs.flatMap((q, i) =>
    Array.from({ length: rulesPerQuestion }, (_, r) => ({
      id: `r${i}_${r}`,
      on: { event: "question_answered", questionId: q.id },
      when: {
        type: "all",
        conditions: [
          {
            type: "compare",
            left: { type: "answer", questionId: q.id },
            op: "eq",
            right: { type: "literal", value: `q${i}_b` },
          },
          {
            type: "compare",
            left: { type: "variable", variableId: "v_total" },
            op: "gte",
            right: { type: "literal", value: 0 },
          },
        ],
      },
      then: [
        {
          type: "set_variable",
          variableId: "v_total",
          op: "add",
          value: {
            type: "binary",
            op: "+",
            left: { type: "variable", variableId: "v_score" },
            right: { type: "literal", value: 1 },
          },
        },
        ...(r === 0 && i % 10 === 0 && i + 2 < questions
          ? [{ type: "jump_to_question", questionId: `q${i + 2}` }]
          : []),
      ],
    })),
  );
  const schema = parseFormSchema({
    schemaVersion: 1,
    meta: { title: "Synthetic" },
    theme: {},
    endings: [{ id: "end", title: "Done", isDefault: true }],
    variables: [
      { id: "v_score", name: "score", type: "number" },
      { id: "v_total", name: "total", type: "number" },
    ],
    questions: qs,
    logic: [],
    rules,
  });
  return { compiled: compileFormSchema(schema), answers };
}
