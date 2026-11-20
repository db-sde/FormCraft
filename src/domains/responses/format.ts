import type { QuestionV1 } from "@/domains/forms/schema/v1";
import {
  ADDRESS_FIELD_LABELS,
  CONTACT_FIELD_LABELS,
} from "@/domains/forms/schema/question-types";
import { formatDateTime } from "@/domains/logic/datetime";
import {
  CONSENT_KIND_LABELS,
  formatConsent,
  formatDateRange,
} from "@/domains/forms/range-consent";
import { entryName, fieldAsQuestion, groupEntries } from "@/domains/forms/repeat-group";
import {
  describeOrder,
  formatMoney,
  orderFromAnswer,
  quantities,
} from "@/domains/forms/products";

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
    case "page_break":
      return "";

    case "address": {
      const record = contactRecord(value);
      return question.settings.fields
        .map((field) => record[field])
        .filter((v): v is string => typeof v === "string" && v.trim() !== "")
        .join(", ");
    }

    case "ranking": {
      if (!Array.isArray(value)) return String(value);
      return value
        .map(
          (id, i) =>
            `${i + 1}. ${question.settings.options.find((o) => o.id === id)?.label ?? String(id)}`,
        )
        .join("; ");
    }

    case "matrix": {
      const record = contactRecord(value);
      return question.settings.rows
        .filter((row) => matrixCell(question, record[row.id]) !== "")
        .map((row) => `${row.label}: ${matrixCell(question, record[row.id])}`)
        .join("; ");
    }

    case "datetime":
      return typeof value === "string" ? formatDateTime(value) : String(value);

    case "date_range":
      return formatDateRange(question, value);

    case "consent":
      return formatConsent(value);

    // One line per entry, in the order entered (F-56).
    case "repeat_group":
      return groupEntries(value)
        .map((entry, i) => {
          const parts = question.settings.fields
            .map((field) => {
              const shown = formatAnswerValue(
                fieldAsQuestion(question, field, entry.id),
                entry.values[field.id],
                context,
              );
              return shown ? `${field.label}: ${shown}` : "";
            })
            .filter(Boolean);
          return `${entryName(question, i)}: ${parts.join("; ")}`;
        })
        .join("\n");

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

    case "signature":
      return typeof value === "string" && value ? "Signed" : "";

    case "booking":
      return formatBookingAnswer(value);

    case "products":
      return describeOrder(question, value);

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
  if (question.type === "address") {
    return question.settings.fields.map(
      (field) => `${questionColumnLabel(question)} (${ADDRESS_FIELD_LABELS[field]})`,
    );
  }
  if (question.type === "matrix") {
    return question.settings.rows.map(
      (row) => `${questionColumnLabel(question)} (${row.label.trim() || row.id})`,
    );
  }
  // Products: how many of each item, then the order's total.
  if (question.type === "products") {
    return [
      ...question.settings.items.map(
        (item) => `${questionColumnLabel(question)} (${item.label.trim() || item.id})`,
      ),
      `${questionColumnLabel(question)} (Total ${question.settings.currency})`,
    ];
  }
  // A group: one column per field, each entry a line in it (F-56), so
  // the entries line up across the columns.
  if (question.type === "repeat_group") {
    return question.settings.fields.map(
      (field) => `${questionColumnLabel(question)} (${field.label.trim() || field.id})`,
    );
  }
  // A range's dates and length in their own columns (F-58), so a
  // spreadsheet can sort and sum them.
  if (question.type === "date_range") {
    const unit = question.settings.count === "nights" ? "Nights" : "Days";
    return [
      `${questionColumnLabel(question)} (Start)`,
      `${questionColumnLabel(question)} (End)`,
      `${questionColumnLabel(question)} (${unit})`,
    ];
  }
  // Consent evidence (F-62): what was ticked, which notice, and when.
  if (question.type === "consent") {
    const columns = [`${questionColumnLabel(question)} (Accepted)`];
    if (question.settings.optInLabel) {
      columns.push(`${questionColumnLabel(question)} (Opt-in)`);
    }
    columns.push(
      `${questionColumnLabel(question)} (Notice version)`,
      `${questionColumnLabel(question)} (Accepted at)`,
    );
    return columns;
  }
  return [questionColumnLabel(question)];
}

/** One matrix row's answer as its column label(s). */
function matrixCell(
  question: Extract<QuestionV1, { type: "matrix" }>,
  cell: unknown,
): string {
  const label = (id: unknown) =>
    question.settings.columns.find((c) => c.id === id)?.label ?? String(id);
  if (Array.isArray(cell)) return cell.map(label).join(", ");
  return typeof cell === "string" && cell !== "" ? label(cell) : "";
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
  if (columnsFrom.type === "contact_info" || columnsFrom.type === "address") {
    const record = contactRecord(value);
    return columnsFrom.settings.fields.map((field: string) => {
      const v = record[field];
      return typeof v === "string" ? v : "";
    });
  }
  if (columnsFrom.type === "matrix") {
    const record = contactRecord(value);
    // Labels come from the version answered; the columns, from the latest.
    const answered = question.type === "matrix" ? question : columnsFrom;
    return columnsFrom.settings.rows.map((row) => matrixCell(answered, record[row.id]));
  }
  if (columnsFrom.type === "products") {
    const qty = quantities(value);
    // Quantities per the latest items; the total from the prices the
    // respondent actually saw (the version answered).
    const answered = question.type === "products" ? question : columnsFrom;
    const order = orderFromAnswer(answered, value);
    return [
      ...columnsFrom.settings.items.map((item) =>
        typeof qty[item.id] === "number" ? String(qty[item.id]) : "",
      ),
      order.lines.length ? formatMoney(order.total, order.currency) : "",
    ];
  }
  if (columnsFrom.type === "repeat_group") {
    const entries = groupEntries(value);
    const answered = question.type === "repeat_group" ? question : columnsFrom;
    return columnsFrom.settings.fields.map((field) => {
      const asked = answered.settings.fields.find((f) => f.id === field.id) ?? field;
      return entries
        .map((entry) =>
          formatAnswerValue(
            fieldAsQuestion(answered, asked, entry.id),
            entry.values[field.id],
            context,
          ),
        )
        .join("\n");
    });
  }
  if (columnsFrom.type === "date_range") {
    const parts = contactRecord(value);
    const day = (v: unknown) => (typeof v === "string" ? v : "");
    return [
      day(parts.start),
      day(parts.end),
      typeof parts.days === "number" ? String(parts.days) : "",
    ];
  }
  if (columnsFrom.type === "consent") {
    const parts = contactRecord(value);
    const yesNo = (v: unknown) => (typeof v === "boolean" ? (v ? "Yes" : "No") : "");
    const cells = [yesNo(parts.acknowledged)];
    if (columnsFrom.settings.optInLabel) cells.push(yesNo(parts.optIn));
    cells.push(
      [
        typeof parts.kind === "string" ? CONSENT_KIND_LABELS[parts.kind] : undefined,
        parts.versionLabel,
        parts.version,
      ]
        .filter((v): v is string => typeof v === "string" && v !== "")
        .join(" · "),
      typeof parts.acceptedAt === "string" ? parts.acceptedAt : "",
    );
    return cells;
  }
  return [formatAnswerValue(question, value, context)];
}

/** "Tue, 3 Nov 2026, 14:00 (Europe/London)" — in the zone the
 * respondent picked it in, else UTC. */
export function formatBookingAnswer(value: unknown): string {
  const v = (value ?? {}) as { start?: unknown; timeZone?: unknown };
  if (typeof v.start !== "string") return "";
  const zone = typeof v.timeZone === "string" ? v.timeZone : "UTC";
  try {
    return `${new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: zone,
    }).format(new Date(v.start))} (${zone})`;
  } catch {
    return v.start;
  }
}

/** Export columns (CSV and Excel): the answer's own columns, plus a link
 * column after a file or signature (QA FC4-17). The link opens the file
 * for a signed-in teammate. Not used by the Sheets sync, whose column
 * layout existing spreadsheets depend on. */
export function exportColumnLabels(question: QuestionV1): string[] {
  const labels = questionColumnLabels(question);
  return question.type === "file_upload" || question.type === "signature"
    ? [...labels, `${questionColumnLabel(question)} (link)`]
    : labels;
}

export function exportAnswerCells(
  columnsFrom: QuestionV1,
  question: QuestionV1,
  value: unknown,
  context: { uploadNames?: ReadonlyMap<string, string>; appUrl?: string } = {},
): string[] {
  const cells = answerCells(columnsFrom, question, value, context);
  if (columnsFrom.type !== "file_upload" && columnsFrom.type !== "signature")
    return cells;
  const link =
    typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)
      ? `${context.appUrl ?? ""}/api/uploads/${value}`
      : "";
  return [...cells, link];
}

/**
 * A short form of an answer for one table cell (QA FC11-10): a group's
 * count and first values, a consent's outcome and notice. The full
 * answer is in the response itself (answerDetailValue) and the cell's
 * tooltip. Everything else is formatAnswerValue.
 */
export function previewAnswerValue(
  question: QuestionV1,
  value: unknown,
  context: { uploadNames?: ReadonlyMap<string, string> } = {},
): string {
  if (question.type === "repeat_group") {
    const entries = groupEntries(value);
    if (entries.length === 0) return "";
    const word = question.settings.entryLabel?.trim().toLowerCase() || "entry";
    const first = question.settings.fields[0];
    const names = entries
      .map((e) =>
        first
          ? formatAnswerValue(fieldAsQuestion(question, first, e.id), e.values[first.id])
          : "",
      )
      .filter(Boolean);
    const count = `${entries.length} ${entries.length === 1 ? word : /[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`}`;
    return names.length ? `${count}: ${names.join(", ")}` : count;
  }
  if (question.type === "consent") {
    const parts = contactRecord(value);
    if (typeof parts.acknowledged !== "boolean") return "";
    return [
      parts.acknowledged ? "Accepted" : "Not accepted",
      typeof parts.versionLabel === "string" ? parts.versionLabel : null,
      typeof parts.acceptedAt === "string" ? parts.acceptedAt.slice(0, 10) : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return formatAnswerValue(question, value, context);
}

/**
 * An answer in full, for the response page (QA FC11-02 / FC11-10): an
 * address as one labelled line per part (it is stored part by part, and
 * exported in a column each), a consent record with every detail.
 */
export function answerDetailValue(
  question: QuestionV1,
  value: unknown,
  context: { uploadNames?: ReadonlyMap<string, string> } = {},
): string {
  if (question.type === "address") {
    const record = contactRecord(value);
    return question.settings.fields
      .filter((field) => typeof record[field] === "string" && record[field] !== "")
      .map((field) => `${ADDRESS_FIELD_LABELS[field]}: ${record[field] as string}`)
      .join("\n");
  }
  if (question.type === "consent") {
    const parts = contactRecord(value);
    if (typeof parts.acknowledged !== "boolean") return "";
    const lines = [parts.acknowledged ? "Accepted" : "Not accepted"];
    if (question.settings.optInLabel) {
      lines.push(
        `Opt-in (${question.settings.optInLabel}): ${parts.optIn ? "yes" : "no"}`,
      );
    }
    if (typeof parts.kind === "string")
      lines.push(`Kind: ${CONSENT_KIND_LABELS[parts.kind] ?? parts.kind}`);
    if (typeof parts.versionLabel === "string")
      lines.push(`Version: ${parts.versionLabel}`);
    if (typeof parts.version === "string") lines.push(`Wording code: ${parts.version}`);
    if (typeof parts.acceptedAt === "string") lines.push(`Recorded: ${parts.acceptedAt}`);
    return lines.join("\n");
  }
  return formatAnswerValue(question, value, context);
}
