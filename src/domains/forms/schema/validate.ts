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

// Friendly wording for the settings a creator can actually get wrong in
// the builder, keyed by the offending field name.
const FIELD_PROBLEMS: Record<string, string> = {
  maxSizeMb: "max file size must be a whole number from 1 to 100 MB",
  acceptedMimeTypes: "add at least one accepted file type",
  options: "add at least one option",
  redirectUrl: "redirect URL must be a full address like https://example.com",
  logoUrl: "logo URL must be a full address like https://example.com",
  backgroundImageUrl: "background image URL must be a full address",
  defaultCountry: "country code must be two letters, like US",
  minLength: "min length must be a whole number of 0 or more",
  maxLength: "max length is out of range",
  minSelections: "min selections must be a whole number of 0 or more",
  maxSelections: "max selections must be a whole number of 1 or more",
  decimals: "decimal places must be a whole number from 0 to 10",
  min: "min must be a whole number",
  max: "max must be a whole number",
  primaryColor: "colors must be hex values like #1a2b3c",
  backgroundColor: "colors must be hex values like #1a2b3c",
  textColor: "colors must be hex values like #1a2b3c",
  label: "text is too long",
  title: "title is too long",
  description: "description is too long",
};

export interface SchemaProblem {
  /** Creator-facing explanation, prefixed with where the problem is. */
  message: string;
  /** Set when the problem belongs to one question / ending, so the
   * builder can show it next to that item's settings. */
  questionId?: string;
  endingId?: string;
}

/**
 * Explains, in creator-facing language, why a draft can't be saved —
 * or returns null when it's valid. The builder runs this before every
 * autosave so an invalid setting is surfaced immediately and pointed at
 * the right question, instead of failing on the server with an opaque
 * structural error. The server still validates independently.
 */
export function describeSchemaProblem(raw: unknown): SchemaProblem | null {
  const result = FormSchemaV1.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const { where, ...owner } = locate(raw, issue.path);
    return { ...owner, message: `${where}: ${explainIssue(issue.path, issue.message)}` };
  }
  try {
    validateSemantics(result.data);
  } catch (error) {
    if (error instanceof FormSchemaError) {
      return { message: "Logic: a rule points at something that no longer exists" };
    }
    throw error;
  }
  return null;
}

function explainIssue(path: PropertyKey[], message: string): string {
  // Cross-field refinements (min <= max) carry their own readable message.
  if (path[path.length - 1] === "settings") return message;
  const field = [...path].reverse().find((p) => typeof p === "string");
  return (typeof field === "string" && FIELD_PROBLEMS[field]) || message;
}

function locate(
  raw: unknown,
  path: PropertyKey[],
): { where: string; questionId?: string; endingId?: string } {
  const [section, index] = path;
  const schema = raw as {
    questions?: { id?: string; order?: number; label?: string }[];
    endings?: { id?: string; title?: string }[];
  };
  if (section === "questions" && typeof index === "number" && schema.questions) {
    // Match the 1-based numbering shown in the builder's question list.
    const target = schema.questions[index];
    const position =
      [...schema.questions]
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .indexOf(target) + 1;
    return { where: `Question ${position || index + 1}`, questionId: target?.id };
  }
  if (section === "endings" && typeof index === "number") {
    const ending = schema.endings?.[index];
    const title = ending?.title?.trim();
    return {
      where: title ? `Ending “${title}”` : `Ending ${index + 1}`,
      endingId: ending?.id,
    };
  }
  if (section === "theme") return { where: "Theme" };
  if (section === "logic") return { where: "Logic" };
  return { where: "Form" };
}
