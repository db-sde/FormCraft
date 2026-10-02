import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  analyzeLogic,
  parseFormSchema,
  validateSemantics,
  FormSchemaError,
} from "@/domains/forms/schema";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";

type FormInput = z.input<typeof FormSchemaV1>;

const base: FormInput = {
  schemaVersion: 1,
  meta: { title: "t" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    {
      id: "role",
      type: "single_select",
      order: 0,
      label: "Role",
      settings: {
        options: [
          { id: "student", label: "Student" },
          { id: "pro", label: "Pro" },
        ],
      },
    },
    { id: "age", type: "number", order: 1, label: "Age", settings: {} },
    { id: "last", type: "short_text", order: 2, label: "Last", settings: {} },
  ],
  logic: [],
  variables: [
    { id: "score", name: "score", type: "number" },
    { id: "tags", name: "tags", type: "list" },
  ],
};

function issues(overrides: Partial<FormInput>) {
  return analyzeLogic(parseFormSchema({ ...base, ...overrides }));
}
const codes = (overrides: Partial<FormInput>) => issues(overrides).map((i) => i.code);

const ageOver = (n: number) => ({
  type: "compare" as const,
  left: { type: "answer" as const, questionId: "age" },
  op: "gt" as const,
  right: { type: "literal" as const, value: n },
});

describe("analyzeLogic", () => {
  it("passes a clean form", () => {
    expect(issues({})).toEqual([]);
  });

  it("finds references to deleted questions, variables and URL fields", () => {
    expect(
      codes({
        rules: [
          {
            id: "r",
            on: { event: "question_answered", questionId: "role" },
            when: {
              type: "all",
              conditions: [
                {
                  type: "compare",
                  left: { type: "answer", questionId: "gone" },
                  op: "is_empty",
                },
                {
                  type: "compare",
                  left: { type: "variable", variableId: "nope" },
                  op: "is_empty",
                },
                {
                  type: "compare",
                  left: { type: "hidden", name: "utm" },
                  op: "is_empty",
                },
              ],
            },
            then: [{ type: "jump_to_ending", endingId: "missing" }],
          },
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        "missing_question",
        "missing_variable",
        "missing_hidden_field",
        "missing_target",
      ]),
    );
  });

  it("refuses backward jumps and jumps from start/completion rules", () => {
    expect(
      codes({
        rules: [
          {
            id: "back",
            on: { event: "question_answered", questionId: "last" },
            then: [{ type: "jump_to_question", questionId: "role" }],
          },
          {
            id: "end",
            on: { event: "form_completed" },
            then: [{ type: "jump_to_question", questionId: "last" }],
          },
        ],
      }),
    ).toEqual(expect.arrayContaining(["backward_jump", "jump_not_allowed"]));
  });

  it("catches an option that no longer exists", () => {
    expect(
      codes({
        rules: [
          {
            id: "r",
            on: { event: "question_answered", questionId: "role" },
            when: {
              type: "compare",
              left: { type: "answer", questionId: "role" },
              op: "eq",
              right: { type: "literal", value: "deleted_option" },
            },
            then: [{ type: "jump_to_ending", endingId: "end" }],
          },
        ],
      }),
    ).toContain("missing_option");
  });

  it("catches type mistakes and division by zero", () => {
    expect(
      codes({
        rules: [
          {
            id: "r",
            on: { event: "form_completed" },
            then: [
              {
                type: "set_variable",
                variableId: "tags",
                op: "multiply",
                value: { type: "literal", value: 2 },
              },
              {
                type: "set_variable",
                variableId: "score",
                op: "append",
                value: { type: "literal", value: "x" },
              },
              {
                type: "set_variable",
                variableId: "score",
                op: "divide",
                value: { type: "literal", value: 0 },
              },
            ],
          },
        ],
      }),
    ).toEqual(expect.arrayContaining(["wrong_type", "division_by_zero"]));
  });

  it("warns about conditions that can never be true", () => {
    const result = issues({
      rules: [
        {
          id: "r",
          on: { event: "question_answered", questionId: "age" },
          when: {
            type: "all",
            conditions: [
              ageOver(50),
              {
                type: "compare",
                left: { type: "answer", questionId: "age" },
                op: "lt",
                right: { type: "literal", value: 20 },
              },
            ],
          },
          then: [{ type: "jump_to_ending", endingId: "end" }],
        },
      ],
    });
    expect(result).toContainEqual(
      expect.objectContaining({ severity: "warning", code: "impossible_condition" }),
    );
  });

  it("warns when an earlier rule always decides, so a later jump can't run", () => {
    expect(
      codes({
        rules: [
          {
            id: "a",
            on: { event: "question_answered", questionId: "role" },
            then: [{ type: "jump_to_question", questionId: "last" }],
          },
          {
            id: "b",
            on: { event: "question_answered", questionId: "role" },
            when: ageOver(1),
            then: [{ type: "jump_to_question", questionId: "age" }],
          },
        ],
      }),
    ).toContain("shadowed_rule");
  });

  it("checks show conditions", () => {
    const result = issues({
      questions: [
        ...(base.questions as object[]).slice(0, 2),
        {
          id: "last",
          type: "short_text",
          order: 2,
          label: "Last",
          required: true,
          settings: {},
          visibleIf: {
            type: "compare",
            left: { type: "answer", questionId: "last" },
            op: "is_empty",
          },
        },
      ] as FormInput["questions"],
    });
    expect(result.map((i) => i.code)).toEqual(
      expect.arrayContaining(["self_reference", "required_conditional"]),
    );
  });

  it("needs a value for operators that compare against one", () => {
    expect(
      codes({
        rules: [
          {
            id: "r",
            on: { event: "question_answered", questionId: "age" },
            when: {
              type: "compare",
              left: { type: "answer", questionId: "age" },
              op: "between",
              right: { type: "literal", value: 1 },
            },
            then: [{ type: "jump_to_ending", endingId: "end" }],
          },
        ],
      }),
    ).toContain("missing_value");
  });

  it("rejects duplicate names", () => {
    expect(
      codes({
        variables: [
          { id: "a", name: "score", type: "number" },
          { id: "b", name: "score", type: "number" },
        ],
        hiddenFields: [{ name: "score" }],
      }),
    ).toContain("duplicate_name");
  });

  it("makes validateSemantics refuse the first error, and allow warnings", () => {
    expect(() =>
      validateSemantics(
        parseFormSchema({
          ...base,
          rules: [
            {
              id: "back",
              on: { event: "question_answered", questionId: "last" },
              then: [{ type: "jump_to_question", questionId: "role" }],
            },
          ],
        }),
      ),
    ).toThrow(FormSchemaError);
    expect(() =>
      validateSemantics(
        parseFormSchema({
          ...base,
          rules: [
            {
              id: "w",
              on: { event: "question_answered", questionId: "age" },
              when: {
                type: "all",
                conditions: [
                  ageOver(50),
                  {
                    type: "compare",
                    left: { type: "answer", questionId: "age" },
                    op: "lt",
                    right: { type: "literal", value: 20 },
                  },
                ],
              },
              then: [{ type: "jump_to_ending", endingId: "end" }],
            },
          ],
        }),
      ),
    ).not.toThrow();
  });
});
