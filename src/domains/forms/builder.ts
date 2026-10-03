import { nanoid } from "nanoid";
import type { QuestionType, LogicOperator } from "./schema/question-types";
import { backwardJumpRules } from "./schema/validate";
import type {
  QuestionV1,
  OptionV1,
  EndingV1,
  LogicRuleV1,
  LogicActionV1,
} from "./schema/v1";

/** Short, URL-safe, collision-resistant — matches the `stableId` regex
 * in the schema (letters, numbers, -, _). */
function newId(prefix: string): string {
  return `${prefix}_${nanoid(10)}`;
}

const DEFAULT_LABEL: Record<QuestionType, string> = {
  welcome_screen: "Welcome",
  short_text: "Short answer question",
  long_text: "Long answer question",
  email: "What's your email?",
  phone: "What's your phone number?",
  url: "Share a link",
  contact_info: "Where can we reach you?",
  number: "Enter a number",
  single_select: "Pick one",
  multi_select: "Pick any that apply",
  dropdown: "Choose from a list",
  yes_no: "Yes or no?",
  date: "Pick a date",
  rating: "Rate your experience",
  opinion_scale: "How would you rate this?",
  file_upload: "Upload a file",
  statement: "Statement",
};

/** Type-appropriate default `settings`, matching each type's Zod
 * schema in schema/v1.ts (only fields with no `.default()` need to be
 * seeded here — the rest are filled in by parseFormSchema). */
function defaultSettings(type: QuestionType): QuestionV1["settings"] {
  switch (type) {
    case "welcome_screen":
      return { buttonLabel: "Start" };
    case "short_text":
      return {};
    case "long_text":
      return {};
    case "email":
      return {};
    case "phone":
      return {};
    case "url":
      return {};
    case "contact_info":
      return { fields: ["name", "email", "phone"], requiredFields: ["name", "email"] };
    case "number":
      return {};
    case "single_select":
      return { options: [createOption("Option 1"), createOption("Option 2")] };
    case "multi_select":
      return { options: [createOption("Option 1"), createOption("Option 2")] };
    case "dropdown":
      return { options: [createOption("Option 1"), createOption("Option 2")] };
    case "yes_no":
      return {};
    case "date":
      return {};
    case "rating":
      return { scale: 5 };
    case "opinion_scale":
      return { min: 0, max: 10 };
    case "file_upload":
      return { acceptedMimeTypes: ["image/*", "application/pdf"], maxSizeMb: 10 };
    case "statement":
      return { buttonLabel: "Continue" };
  }
}

export function createOption(label = "Option"): OptionV1 {
  return { id: newId("opt"), label };
}

export function createQuestion(type: QuestionType, order: number): QuestionV1 {
  return {
    id: newId("q"),
    type,
    order,
    label: DEFAULT_LABEL[type],
    required: type !== "welcome_screen" && type !== "statement",
    settings: defaultSettings(type),
  } as QuestionV1;
}

/** Reassigns `order` to match array position — call after any
 * insert/remove/move so `order` never drifts from the array's own
 * sequence (order is what the publish compiler and logic engine walk). */
function reindex(questions: QuestionV1[]): QuestionV1[] {
  return questions.map((q, i) => ({ ...q, order: i }));
}

/** A welcome screen is only meaningful as the very first step, so it
 * is pinned there: it can't be moved or duplicated, and nothing can be
 * placed above it. */
export function isWelcomeScreen(question: QuestionV1 | undefined): boolean {
  return question?.type === "welcome_screen";
}

/** Lowest index a regular question may occupy. */
function firstMovableIndex(questions: QuestionV1[]): number {
  return isWelcomeScreen(questions[0]) ? 1 : 0;
}

export function insertQuestion(
  questions: QuestionV1[],
  question: QuestionV1,
  atIndex: number,
): QuestionV1[] {
  if (isWelcomeScreen(question)) {
    // At most one, always first.
    if (questions.some(isWelcomeScreen)) return questions;
    return reindex([question, ...questions]);
  }
  const next = [...questions];
  next.splice(Math.max(atIndex, firstMovableIndex(questions)), 0, question);
  return reindex(next);
}

/**
 * Adds a Contact info (lead capture) block just before the form's last
 * question — the point where a respondent has invested enough to share
 * their details, while there's still a question left so the lead is
 * saved even if they drop off before submitting. Returns the new list
 * and the block's id.
 */
export function insertLeadCapture(questions: QuestionV1[]): {
  questions: QuestionV1[];
  id: string;
} {
  const block = createQuestion("contact_info", 0);
  const lastRegular = questions.length - 1;
  const hasRegularQuestion = lastRegular >= firstMovableIndex(questions);
  const atIndex = hasRegularQuestion ? lastRegular : questions.length;
  return { questions: insertQuestion(questions, block, atIndex), id: block.id };
}

export function hasLeadCapture(questions: QuestionV1[]): boolean {
  return questions.some((q) => q.type === "contact_info");
}

/** Whether `id` may be deleted — a form always keeps at least one
 * question (the schema requires it). */
export function canDeleteQuestion(questions: QuestionV1[], id: string): boolean {
  return questions.length > 1 && questions.some((q) => q.id === id);
}

export function removeQuestion(questions: QuestionV1[], id: string): QuestionV1[] {
  return reindex(questions.filter((q) => q.id !== id));
}

export function duplicateQuestion(questions: QuestionV1[], id: string): QuestionV1[] {
  const index = questions.findIndex((q) => q.id === id);
  if (index === -1 || isWelcomeScreen(questions[index])) return questions;
  const copy: QuestionV1 = {
    ...questions[index],
    id: newId("q"),
    label: `${questions[index].label} (copy)`,
  };
  return insertQuestion(questions, copy, index + 1);
}

export function moveQuestion(
  questions: QuestionV1[],
  id: string,
  direction: "up" | "down",
): QuestionV1[] {
  const index = questions.findIndex((q) => q.id === id);
  if (index === -1) return questions;
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  const min = firstMovableIndex(questions);
  if (index < min || targetIndex < min || targetIndex >= questions.length) {
    return questions;
  }

  const next = [...questions];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return reindex(next);
}

export function reorderQuestions(
  questions: QuestionV1[],
  fromIndex: number,
  toIndex: number,
): QuestionV1[] {
  const min = firstMovableIndex(questions);
  if (
    fromIndex === toIndex ||
    fromIndex < min ||
    toIndex < min ||
    fromIndex >= questions.length ||
    toIndex >= questions.length
  ) {
    return questions;
  }
  const next = [...questions];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return reindex(next);
}

// --- endings -------------------------------------------------------------

export function createEnding(title = "Thank you!"): EndingV1 {
  return { id: newId("end"), title, isDefault: false };
}

/** An ending can only be removed if it isn't the default and isn't the
 * last remaining ending — the schema requires >=1 ending and exactly
 * one marked default at all times (see schema/v1.ts, validateSemantics). */
export function canDeleteEnding(endings: EndingV1[], id: string): boolean {
  const ending = endings.find((e) => e.id === id);
  if (!ending) return false;
  return !ending.isDefault && endings.length > 1;
}

export function removeEnding(endings: EndingV1[], id: string): EndingV1[] {
  if (!canDeleteEnding(endings, id)) return endings;
  return endings.filter((e) => e.id !== id);
}

export function setDefaultEnding(endings: EndingV1[], id: string): EndingV1[] {
  return endings.map((e) => ({ ...e, isDefault: e.id === id }));
}

// --- logic -----------------------------------------------------------------

/** A sensible starting rule: "when this question is answered, jump to
 * <defaultTarget>". The creator edits the operator/value/target from
 * there — this just avoids handing them a rule with no action at all. */
export function createLogicRule(
  questionId: string,
  defaultTarget: LogicActionV1,
): LogicRuleV1 {
  return {
    id: newId("rule"),
    questionId,
    operator: "is_answered" satisfies LogicOperator,
    action: defaultTarget,
  };
}

export function removeLogicRule(logic: LogicRuleV1[], id: string): LogicRuleV1[] {
  return logic.filter((r) => r.id !== id);
}

/** Rules that would become dangling if `questionId` were deleted: ones
 * sourced from it, and ones that jump to it. Used to warn before a
 * destructive delete rather than silently leaving a broken reference
 * (spec requirement — see docs/form-schema.md). */
export function rulesReferencingQuestion(
  logic: LogicRuleV1[],
  questionId: string,
): LogicRuleV1[] {
  return logic.filter(
    (r) =>
      r.questionId === questionId ||
      (r.action.type === "jump_to_question" && r.action.questionId === questionId),
  );
}

export function rulesReferencingEnding(
  logic: LogicRuleV1[],
  endingId: string,
): LogicRuleV1[] {
  return logic.filter(
    (r) => r.action.type === "jump_to_ending" && r.action.endingId === endingId,
  );
}

const OPTION_BEARING: QuestionType[] = ["single_select", "multi_select", "dropdown"];
const NUMERIC_TYPES: QuestionType[] = ["number", "rating", "opinion_scale"];

/** Operators offered for a given source question type. Narrower than
 * what the schema technically accepts (validateSemantics only rejects
 * "contains" on non-option types — gt/lt on a text question is
 * structurally valid, just never useful), kept here rather than in the
 * schema module since it's a builder UX concern, not a data-integrity
 * rule. Only operators that can actually match are offered: a
 * multi-select answer is a list, so "is" could never be true, and a
 * contact block or an uploaded file has no single value to compare. */
export function availableOperators(type: QuestionType): LogicOperator[] {
  const answered: LogicOperator[] = ["is_answered", "is_not_answered"];
  if (type === "contact_info" || type === "file_upload") return answered;
  if (type === "multi_select") return [...answered, "contains"];
  const base: LogicOperator[] = [...answered, "equals", "not_equals"];
  if (OPTION_BEARING.includes(type)) return [...base, "contains"];
  if (NUMERIC_TYPES.includes(type)) return [...base, "gt", "lt"];
  return base;
}

/** Questions a rule on `questionId` may jump to: only ones further on.
 * Jumping back can trap a respondent in a loop (see backwardJumpRules). */
export function questionsAfter(
  questions: QuestionV1[],
  questionId: string,
): QuestionV1[] {
  const ordered = [...questions].sort((a, b) => a.order - b.order);
  const index = ordered.findIndex((q) => q.id === questionId);
  return index === -1 ? [] : ordered.slice(index + 1);
}

/** Rules on `questionId` that compare against an option no longer in
 * `remainingOptionIds` — deleting an option leaves them pointing at
 * nothing, so they'd silently stop matching. */
export function rulesBrokenByOptionRemoval(
  logic: LogicRuleV1[],
  questionId: string,
  remainingOptionIds: ReadonlySet<string>,
): LogicRuleV1[] {
  return logic.filter(
    (rule) =>
      rule.questionId === questionId &&
      (rule.operator === "equals" ||
        rule.operator === "not_equals" ||
        rule.operator === "contains") &&
      typeof rule.value === "string" &&
      !remainingOptionIds.has(rule.value),
  );
}

/** Rules that start jumping backwards once the questions are arranged
 * as `next` — a reorder that would create them is refused. */
export function rulesBrokenByReorder(
  logic: LogicRuleV1[],
  before: QuestionV1[],
  next: QuestionV1[],
): LogicRuleV1[] {
  const alreadyBackward = new Set(
    backwardJumpRules({ questions: before, logic }).map((r) => r.id),
  );
  return backwardJumpRules({ questions: next, logic }).filter(
    (r) => !alreadyBackward.has(r.id),
  );
}

// --- changing a question's type ------------------------------------------

const TEXT_TYPES: QuestionType[] = ["short_text", "long_text", "email", "phone", "url"];
const CHOICE_TYPES: QuestionType[] = ["single_select", "multi_select", "dropdown"];

function family(type: QuestionType): "text" | "choice" | QuestionType {
  if (TEXT_TYPES.includes(type)) return "text";
  if (CHOICE_TYPES.includes(type)) return "choice";
  return type;
}

/**
 * Converts a question to another type, keeping its id (so responses and
 * logic references stay attached), text and required flag, and carrying
 * over whatever settings still make sense: text-like types keep
 * placeholder/length limits, choice types keep their options. `lossy`
 * is true when settings had to be reset, so the builder can warn first.
 */
export function convertQuestion(
  question: QuestionV1,
  to: QuestionType,
): { question: QuestionV1; lossy: boolean } {
  if (question.type === to) return { question, lossy: false };
  const fresh = createQuestion(to, question.order);
  const base = {
    ...fresh,
    id: question.id,
    label: question.label,
    description: question.description,
    required:
      to === "welcome_screen" || to === "statement"
        ? false
        : question.type === "welcome_screen" || question.type === "statement"
          ? fresh.required
          : question.required,
  } as QuestionV1;

  const from = question.settings as Record<string, unknown>;
  if (family(question.type) === "text" && family(to) === "text") {
    const carried: Record<string, unknown> = { ...base.settings };
    if (
      (to === "short_text" || to === "long_text") &&
      typeof from.placeholder === "string"
    ) {
      carried.placeholder = from.placeholder;
    }
    if (
      (to === "short_text" || to === "long_text") &&
      typeof from.maxLength === "number"
    ) {
      carried.maxLength = from.maxLength;
    }
    return { question: { ...base, settings: carried } as QuestionV1, lossy: false };
  }
  if (family(question.type) === "choice" && family(to) === "choice") {
    const carried: Record<string, unknown> = { ...base.settings, options: from.options };
    const droppedOther = Boolean(from.allowOther) && to === "dropdown";
    if (to !== "dropdown") carried.allowOther = Boolean(from.allowOther);
    const droppedLimits =
      question.type === "multi_select" &&
      (from.minSelections !== undefined || from.maxSelections !== undefined);
    return {
      question: { ...base, settings: carried } as QuestionV1,
      lossy: droppedOther || droppedLimits,
    };
  }
  return { question: base, lossy: true };
}

/** Logic rules on `questionId` that stop making sense once it becomes
 * `to` — all of them across families (their values no longer match),
 * otherwise those whose operator the new type doesn't offer. */
export function rulesBrokenByTypeChange(
  logic: LogicRuleV1[],
  questionId: string,
  from: QuestionType,
  to: QuestionType,
): LogicRuleV1[] {
  const operators = availableOperators(to);
  const sameFamily = family(from) === family(to);
  return logic.filter(
    (rule) =>
      rule.questionId === questionId &&
      (!sameFamily || !operators.includes(rule.operator)),
  );
}

/** Starter wording that was never meant to be published as is. */
const PLACEHOLDER_LABELS = new Set(
  (
    [
      "welcome_screen",
      "short_text",
      "long_text",
      "number",
      "single_select",
      "multi_select",
      "dropdown",
      "statement",
    ] as const
  )
    .map((type) => DEFAULT_LABEL[type])
    // A new form's welcome screen carries the form's unnamed title.
    .concat("Untitled form"),
);
const PLACEHOLDER_OPTION = /^Option \d+$/;

/** Questions still carrying starter wording ("Pick one", "Option 2"),
 * in form order — so a creator can be told before respondents see it. */
export function questionsWithPlaceholders(questions: QuestionV1[]): QuestionV1[] {
  return [...questions]
    .sort((a, b) => a.order - b.order)
    .filter((question) => {
      if (PLACEHOLDER_LABELS.has(question.label.trim())) return true;
      const options = (question.settings as { options?: { label: string }[] }).options;
      // Carried-forward options are another question's, checked there.
      const carried = (question.settings as { optionsFrom?: unknown }).optionsFrom;
      return !carried && !!options?.some((o) => PLACEHOLDER_OPTION.test(o.label.trim()));
    });
}
