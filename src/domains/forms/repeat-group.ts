import type { GroupFieldV1, QuestionV1 } from "./schema/v1";

/**
 * Repeatable field groups (F-56). A group's fields are ordinary question
 * types, so each one is checked, cleaned and shown by the same code as a
 * question of that type: `fieldAsQuestion` gives the stand-in question.
 */
export type RepeatGroupQuestion = Extract<QuestionV1, { type: "repeat_group" }>;

export type GroupEntry = { id: string; values: Record<string, unknown> };

const ENTRY_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The entries out of a stored or sent answer, in order. Anything that
 * isn't an entry is dropped (and fails validation on its own). */
export function groupEntries(value: unknown): GroupEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (e): e is GroupEntry =>
      !!e &&
      typeof e === "object" &&
      typeof (e as GroupEntry).id === "string" &&
      ENTRY_ID.test((e as GroupEntry).id) &&
      !!(e as GroupEntry).values &&
      typeof (e as GroupEntry).values === "object" &&
      !Array.isArray((e as GroupEntry).values),
  );
}

/** A group field as the question it stands in for. */
export function fieldAsQuestion(
  group: Pick<RepeatGroupQuestion, "id">,
  field: GroupFieldV1,
  entryId = "entry",
): QuestionV1 {
  const base = {
    id: `${group.id}__${entryId}__${field.id}`.slice(0, 120),
    order: 0,
    label: field.label,
    required: field.required,
  };
  switch (field.type) {
    case "short_text":
    case "long_text":
      return {
        ...base,
        type: field.type,
        settings: field.placeholder ? { placeholder: field.placeholder } : {},
      } as QuestionV1;
    case "dropdown":
      return { ...base, type: "dropdown", settings: { options: field.options ?? [] } };
    case "yes_no":
      return { ...base, type: "yes_no", settings: {} };
    default:
      return { ...base, type: field.type, settings: {} } as QuestionV1;
  }
}

function filled(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  return true;
}

/** Whether a field shows in an entry, by its own condition on a field
 * above it in the same entry (a hidden field is never required). */
export function fieldVisible(
  field: GroupFieldV1,
  values: Record<string, unknown>,
  fields: readonly GroupFieldV1[],
): boolean {
  const rule = field.showIf;
  if (!rule) return true;
  const source = fields.find((f) => f.id === rule.fieldId);
  // The field it depends on must itself be showing.
  if (!source || !fieldVisible(source, values, fields)) return false;
  const v = values[rule.fieldId];
  switch (rule.op) {
    case "is_filled":
      return filled(v);
    case "is_empty":
      return !filled(v);
    case "equals":
      return v === rule.value;
    case "not_equals":
      return v !== rule.value;
  }
}

/** What one entry is called, numbered from 1. */
export function entryName(question: RepeatGroupQuestion, index: number): string {
  return `${question.settings.entryLabel?.trim() || "Entry"} ${index + 1}`;
}

/** Whether any entry has any value. */
export function groupHasAnswer(value: unknown): boolean {
  return groupEntries(value).some((e) => Object.values(e.values).some(filled));
}

/** An entry with nothing filled in: dropped before it's checked or kept,
 * so an "Add another" pressed by mistake isn't an error. */
export function isBlankEntry(entry: GroupEntry): boolean {
  return !Object.values(entry.values).some(filled);
}
