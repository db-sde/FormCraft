export const QUESTION_TYPES = [
  "welcome_screen",
  "short_text",
  "long_text",
  "email",
  "phone",
  "url",
  "contact_info",
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

/** The sub-fields a Contact info (lead capture) block can ask for. Its
 * answer is stored as `{ name?, email?, phone?, company? }`. */
export const CONTACT_FIELDS = ["name", "email", "phone", "company"] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];

export const CONTACT_FIELD_LABELS: Record<ContactField, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  company: "Company",
};

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
