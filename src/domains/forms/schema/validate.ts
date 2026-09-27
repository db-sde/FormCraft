import {
  FormSchemaV1,
  OPTION_BEARING_TYPES,
  type FormSchemaV1 as FormSchemaV1Type,
} from "./v1";

export class FormSchemaError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "FormSchemaError";
  }
}

/** Stage 1+2: transport decode + structural validation. */
export function parseFormSchema(raw: unknown): FormSchemaV1Type {
  const result = FormSchemaV1.safeParse(raw);
  if (!result.success) {
    throw new FormSchemaError(
      `structural validation failed: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      "structural_invalid",
    );
  }
  return result.data;
}

/**
 * Stage 3: semantic validation. Duplicate ids, dangling logic references,
 * option-scoped operators used against non-option question types, and
 * exactly one default ending.
 */
export function validateSemantics(schema: FormSchemaV1Type): void {
  const questionIds = new Set<string>();
  for (const q of schema.questions) {
    if (questionIds.has(q.id)) {
      throw new FormSchemaError(
        `duplicate question id: ${q.id}`,
        "duplicate_question_id",
      );
    }
    questionIds.add(q.id);
  }

  const endingIds = new Set<string>();
  let defaultCount = 0;
  for (const e of schema.endings) {
    if (endingIds.has(e.id)) {
      throw new FormSchemaError(`duplicate ending id: ${e.id}`, "duplicate_ending_id");
    }
    endingIds.add(e.id);
    if (e.isDefault) defaultCount += 1;
  }
  if (defaultCount !== 1) {
    throw new FormSchemaError(
      `exactly one ending must be marked isDefault (found ${defaultCount})`,
      "invalid_default_ending",
    );
  }

  const logicIds = new Set<string>();
  for (const rule of schema.logic) {
    if (logicIds.has(rule.id)) {
      throw new FormSchemaError(
        `duplicate logic rule id: ${rule.id}`,
        "duplicate_logic_id",
      );
    }
    logicIds.add(rule.id);

    const sourceQuestion = schema.questions.find((q) => q.id === rule.questionId);
    if (!sourceQuestion) {
      throw new FormSchemaError(
        `logic rule ${rule.id} references unknown question ${rule.questionId}`,
        "dangling_logic_source",
      );
    }

    if (rule.operator === "contains" && !OPTION_BEARING_TYPES.has(sourceQuestion.type)) {
      throw new FormSchemaError(
        `logic rule ${rule.id} uses "contains" against non-option question ${rule.questionId}`,
        "invalid_operator_for_type",
      );
    }

    if (
      rule.action.type === "jump_to_question" &&
      !questionIds.has(rule.action.questionId)
    ) {
      throw new FormSchemaError(
        `logic rule ${rule.id} jumps to unknown question ${rule.action.questionId}`,
        "dangling_logic_target",
      );
    }
    if (rule.action.type === "jump_to_ending" && !endingIds.has(rule.action.endingId)) {
      throw new FormSchemaError(
        `logic rule ${rule.id} jumps to unknown ending ${rule.action.endingId}`,
        "dangling_logic_target",
      );
    }
  }
}
