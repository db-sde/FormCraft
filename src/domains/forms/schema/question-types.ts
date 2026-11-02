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
  // Master spec Phase 1 (2026-10-29).
  "page_break",
  "time",
  "datetime",
  "address",
  "ranking",
  "matrix",
  // Master spec Phase 2 (2026-10-30).
  "signature",
  "products",
  // Master spec Phase 5 (2026-11-02).
  "booking",
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

/** Structured address (F-13): the parts a block can ask for, in the
 * order they're shown. Its answer is `{ line1?, line2?, … }`. No part
 * assumes a country's format — not every country has a state or a
 * fixed-length postcode. */
export const ADDRESS_FIELDS = [
  "line1",
  "line2",
  "city",
  "state",
  "postalCode",
  "country",
] as const;
export type AddressField = (typeof ADDRESS_FIELDS)[number];

export const ADDRESS_FIELD_LABELS: Record<AddressField, string> = {
  line1: "Address line 1",
  line2: "Address line 2",
  city: "City",
  state: "State / province / region",
  postalCode: "Postal code",
  country: "Country",
};

/** Items that never take an answer: screens, and page breaks (which
 * only split the classic layout into pages, F-01). */
export const NON_ANSWERABLE_TYPES = new Set<string>([
  "welcome_screen",
  "statement",
  "page_break",
]);

/** Question types that render an answerable input (vs. purely informational). */
export const ANSWERABLE_QUESTION_TYPES = QUESTION_TYPES.filter(
  (t) => !NON_ANSWERABLE_TYPES.has(t),
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
