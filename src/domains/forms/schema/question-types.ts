export const QUESTION_TYPES = [
  "welcome_screen",
  "short_text",
  "long_text",
  "email",
  "phone",
  "url",
  "number",
  "single_select",
  "multi_select",
  "dropdown",
  "yes_no",
  "date",
  "rating",
  "opinion_scale",
  "file_upload",
  "statement",
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Question types that render an answerable input (vs. purely informational). */
export const ANSWERABLE_QUESTION_TYPES = QUESTION_TYPES.filter(
  (t) => t !== "welcome_screen" && t !== "statement",
);

/** Question types that carry a configurable list of options. */
export const OPTION_BEARING_QUESTION_TYPES = [
  "single_select",
  "multi_select",
  "dropdown",
] as const;

export const LOGIC_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "gt",
  "lt",
  "is_answered",
  "is_not_answered",
] as const;

export type LogicOperator = (typeof LOGIC_OPERATORS)[number];
