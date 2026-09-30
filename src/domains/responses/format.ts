import type { QuestionV1 } from "@/domains/forms/schema/v1";
import { CONTACT_FIELD_LABELS } from "@/domains/forms/schema/question-types";

function contactRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Turns a raw stored answer value (JSON — an option id, a boolean, a
 * number, an array of option ids, an upload reference id, ...) into
 * the human-readable text shown in the response dashboard and CSV
 * export. Both read through this one function so the two never
 * disagree about what an answer "means" — e.g. a multi-select answer
 * is always the joined option *labels*, never raw option ids, in both
 * places (CSV export's "stable multi-choice representation"
 * requirement).
 */
export function formatAnswerValue(
  question: QuestionV1,
  value: unknown,
  context: {
    /** Upload id → the respondent's original file name. */
    uploadNames?: ReadonlyMap<string, string>;
  } = {},
): string {
  if (value === undefined || value === null) return "";

  switch (question.type) {
    case "welcome_screen":
    case "statement":
      return "";

    case "single_select": {
      if (typeof value === "string" && value.startsWith("other:")) return value.slice(6);
      const option = question.settings.options.find((o) => o.id === value);
      return option?.label ?? String(value);
    }

    case "multi_select": {
      if (!Array.isArray(value)) return String(value);
      return value
        .map((v) => {
          if (typeof v === "string" && v.startsWith("other:")) return v.slice(6);
          return question.settings.options.find((o) => o.id === v)?.label ?? String(v);
        })
        .join("; ");
    }

    case "dropdown": {
      const option = question.settings.options.find((o) => o.id === value);
      return option?.label ?? String(value);
    }

    case "yes_no":
      if (typeof value !== "boolean") return String(value);
      return value
        ? question.settings.yesLabel || "Yes"
        : question.settings.noLabel || "No";

    case "contact_info": {
      const record = contactRecord(value);
      return question.settings.fields
        .map((field) => record[field])
        .filter((v): v is string => typeof v === "string" && v.trim() !== "")
        .join(" · ");
    }

    case "file_upload":
      if (typeof value !== "string") return "";
      return context.uploadNames?.get(value) ?? "Uploaded file";

    case "number":
    case "rating":
    case "opinion_scale":
      return String(value);

    case "date":
    case "short_text":
    case "long_text":
    case "email":
    case "phone":
    case "url":
    default:
      return String(value);
  }
}

/** Label used for a question column in the dashboard/export — the
 * question's own label, falling back to its id so a blank/edited-out
 * label never produces an unlabeled column. */
export function questionColumnLabel(question: QuestionV1): string {
  return question.label.trim() || question.id;
}

/** Export columns for a question (CSV, Google Sheets). Most questions
 * are one column; a Contact info block gets one per field so a lead's
 * name, email and phone land in their own spreadsheet columns. */
export function questionColumnLabels(question: QuestionV1): string[] {
  if (question.type === "contact_info") {
    return question.settings.fields.map(
      (field) => `${questionColumnLabel(question)} (${CONTACT_FIELD_LABELS[field]})`,
    );
  }
  return [questionColumnLabel(question)];
}

/** Cells matching questionColumnLabels(`columnsFrom`) — `columnsFrom`
 * fixes the column layout (the latest version's question), while
 * `question` is the version the response actually answered. */
export function answerCells(
  columnsFrom: QuestionV1,
  question: QuestionV1,
  value: unknown,
  context: { uploadNames?: ReadonlyMap<string, string> } = {},
): string[] {
  if (columnsFrom.type === "contact_info") {
    const record = contactRecord(value);
    return columnsFrom.settings.fields.map((field) => {
      const v = record[field];
      return typeof v === "string" ? v : "";
    });
  }
  return [formatAnswerValue(question, value, context)];
}
