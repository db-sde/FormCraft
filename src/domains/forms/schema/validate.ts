import { analyzeLogic } from "./analyze";
import {
  FormSchemaV1,
  OPTION_BEARING_TYPES,
  type FormSchemaV1 as FormSchemaV1Type,
  type LogicRuleV1,
  type QuestionV1,
} from "./v1";

export interface SchemaProblem {
  /** Creator-facing explanation, prefixed with where the problem is. */
  message: string;
  /** Set when the problem belongs to one question / ending, so the
   * builder can show it next to that item's settings. */
  questionId?: string;
  endingId?: string;
}

export class FormSchemaError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    /** What to tell the creator — `message` is for logs and tests and
     * may name raw ids. */
    public readonly problem?: SchemaProblem,
  ) {
    super(message);
    this.name = "FormSchemaError";
  }
}

/** The wording to show a creator for a rejected draft. */
export function schemaErrorMessage(error: FormSchemaError): string {
  return error.problem?.message ?? error.message;
}

/** Questions in the order respondents see them — the same sort the
 * publish compiler uses, so "earlier" and "later" mean the same thing
 * everywhere. */
function sortedQuestions(questions: readonly QuestionV1[]): QuestionV1[] {
  return [...questions].sort((a, b) => a.order - b.order);
}

/** Rules whose "jump to question" lands on the source question itself
 * or on one before it. Going backwards can trap a respondent: the rule
 * that sent them back matches again on the way past, forever. Forward
 * jumps cannot loop, so that is the only direction the builder allows. */
export function backwardJumpRules(
  schema: Pick<FormSchemaV1Type, "questions" | "logic">,
): LogicRuleV1[] {
  const position = new Map(sortedQuestions(schema.questions).map((q, i) => [q.id, i]));
  return schema.logic.filter((rule) => {
    if (rule.action.type !== "jump_to_question") return false;
    const from = position.get(rule.questionId);
    const to = position.get(rule.action.questionId);
    return from !== undefined && to !== undefined && to <= from;
  });
}

/** Option ids a choice question offers; null for other question types. */
export function optionIdsOf(question: QuestionV1): Set<string> | null {
  if (!OPTION_BEARING_TYPES.has(question.type)) return null;
  const settings = question.settings as { options?: { id: string }[] };
  return new Set((settings.options ?? []).map((o) => o.id));
}

function ruleNumber(schema: FormSchemaV1Type, rule: LogicRuleV1): number {
  return schema.logic.findIndex((r) => r.id === rule.id) + 1;
}

function questionNumber(schema: FormSchemaV1Type, questionId: string): number {
  return sortedQuestions(schema.questions).findIndex((q) => q.id === questionId) + 1;
}

function ruleProblem(schema: FormSchemaV1Type, rule: LogicRuleV1, text: string) {
  return { message: `Logic rule ${ruleNumber(schema, rule)}: ${text}` };
}

const OPERATORS_NEEDING_VALUE = new Set(["equals", "not_equals", "contains", "gt", "lt"]);

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
        { message: "Two questions share the same id. Delete one and add it again." },
      );
    }
    questionIds.add(q.id);

    const optionIds = new Set<string>();
    const options = (q.settings as { options?: { id: string }[] }).options ?? [];
    for (const option of options) {
      if (optionIds.has(option.id)) {
        throw new FormSchemaError(
          `question ${q.id} has duplicate option id: ${option.id}`,
          "duplicate_option_id",
          {
            message: `Question ${questionNumber(schema, q.id)}: two options share the same id. Delete one and add it again.`,
            questionId: q.id,
          },
        );
      }
      optionIds.add(option.id);
    }
  }

  const endingIds = new Set<string>();
  let defaultCount = 0;
  for (const e of schema.endings) {
    if (endingIds.has(e.id)) {
      throw new FormSchemaError(`duplicate ending id: ${e.id}`, "duplicate_ending_id", {
        message: "Two endings share the same id. Delete one and add it again.",
      });
    }
    endingIds.add(e.id);
    if (e.isDefault) defaultCount += 1;
  }
  if (defaultCount !== 1) {
    throw new FormSchemaError(
      `exactly one ending must be marked isDefault (found ${defaultCount})`,
      "invalid_default_ending",
      { message: "Endings: exactly one ending must be the default." },
    );
  }

  const logicIds = new Set<string>();
  for (const rule of schema.logic) {
    if (logicIds.has(rule.id)) {
      throw new FormSchemaError(
        `duplicate logic rule id: ${rule.id}`,
        "duplicate_logic_id",
        { message: "Two logic rules share the same id. Delete one and add it again." },
      );
    }
    logicIds.add(rule.id);

    const sourceQuestion = schema.questions.find((q) => q.id === rule.questionId);
    if (!sourceQuestion) {
      throw new FormSchemaError(
        `logic rule ${rule.id} references unknown question ${rule.questionId}`,
        "dangling_logic_source",
        ruleProblem(
          schema,
          rule,
          "the question it checks was deleted. Pick another question or delete the rule.",
        ),
      );
    }

    if (rule.operator === "contains" && !OPTION_BEARING_TYPES.has(sourceQuestion.type)) {
      throw new FormSchemaError(
        `logic rule ${rule.id} uses "contains" against non-option question ${rule.questionId}`,
        "invalid_operator_for_type",
        ruleProblem(schema, rule, "“contains” only works on choice questions."),
      );
    }

    const optionIds = optionIdsOf(sourceQuestion);
    if (
      optionIds &&
      (rule.operator === "equals" ||
        rule.operator === "not_equals" ||
        rule.operator === "contains") &&
      rule.value !== undefined &&
      rule.value !== null &&
      (typeof rule.value !== "string" || !optionIds.has(rule.value))
    ) {
      throw new FormSchemaError(
        `logic rule ${rule.id} compares against an option that ${rule.questionId} does not have`,
        "dangling_logic_option",
        ruleProblem(
          schema,
          rule,
          "the option it checks no longer exists. Choose an option again.",
        ),
      );
    }

    if (
      rule.action.type === "jump_to_question" &&
      !questionIds.has(rule.action.questionId)
    ) {
      throw new FormSchemaError(
        `logic rule ${rule.id} jumps to unknown question ${rule.action.questionId}`,
        "dangling_logic_target",
        ruleProblem(
          schema,
          rule,
          "the question it jumps to was deleted. Pick another question.",
        ),
      );
    }
    if (rule.action.type === "jump_to_ending" && !endingIds.has(rule.action.endingId)) {
      throw new FormSchemaError(
        `logic rule ${rule.id} jumps to unknown ending ${rule.action.endingId}`,
        "dangling_logic_target",
        ruleProblem(
          schema,
          rule,
          "the ending it jumps to was deleted. Pick another ending.",
        ),
      );
    }
  }

  // Rules, variables, visibility and checks (the logic engine's model).
  const logicError = analyzeLogic(schema).find((issue) => issue.severity === "error");
  if (logicError) {
    throw new FormSchemaError(logicError.message, logicError.code, {
      message: logicError.message,
      questionId: logicError.questionId,
    });
  }

  const backward = backwardJumpRules(schema)[0];
  if (backward) {
    throw new FormSchemaError(
      `logic rule ${backward.id} jumps back to question ${(backward.action as { questionId: string }).questionId}`,
      "backward_jump",
      ruleProblem(
        schema,
        backward,
        "jumps back to an earlier question, which could trap respondents in a loop. Jump to a later question or an ending instead.",
      ),
    );
  }
}

/**
 * Everything validateSemantics checks, plus what only matters once a
 * form goes live: a rule still waiting for its comparison value would
 * quietly never match ("is" an unset option) or always match ("is not"
 * an unset option), so publishing is refused until it's filled in.
 */
export function validateForPublish(schema: FormSchemaV1Type): void {
  validateSemantics(schema);
  for (const rule of schema.logic) {
    if (!OPERATORS_NEEDING_VALUE.has(rule.operator)) continue;
    if (rule.value === undefined || rule.value === null || rule.value === "") {
      throw new FormSchemaError(
        `logic rule ${rule.id} has no value to compare against`,
        "incomplete_logic_rule",
        ruleProblem(schema, rule, "choose a value to compare against."),
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
      return error.problem ?? { message: error.message };
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
