/** Phase 1 synchronous export bound — see docs/testing.md. Above this,
 * the export endpoint returns a clear error instead of truncating. */
export const MAX_SYNCHRONOUS_EXPORT_ROWS = 10_000;

export class ExportTooLargeError extends Error {
  constructor(public readonly rowCount: number) {
    super(
      `export has ${rowCount} rows, exceeding the synchronous export limit of ${MAX_SYNCHRONOUS_EXPORT_ROWS}`,
    );
    this.name = "ExportTooLargeError";
  }
}

const FORMULA_TRIGGER_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"]);
/** A plain number ("5", "-5.25"): a spreadsheet reads it as that number
 * and nothing else, so it's left alone and stays numeric. */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
/** A phone number ("+14155550123", "+1 (415) 555-0123"): digits, spaces,
 * brackets, dots and dashes after an optional "+", with at least 7
 * digits. Left as it is so phone columns aren't apostrophe-prefixed (QA
 * FC5-12). A short signed value such as "+1" isn't one (QA FC15-65). */
const PHONE = /^\+?[\d\s().-]+$/;
const looksLikePhone = (value: string) =>
  PHONE.test(value) && (value.match(/\d/g)?.length ?? 0) >= 7;

/**
 * Guards against CSV/spreadsheet formula injection: a cell whose content
 * starts with a character a spreadsheet app would interpret as the start
 * of a formula gets a leading apostrophe so Excel/Sheets render it as
 * literal text instead of executing it. Shared by the CSV export and
 * the Google Sheets sync — respondents control this text.
 */
export function neutralizeFormulaInjection(value: string): string {
  if (value.length === 0) return value;
  if (!FORMULA_TRIGGER_CHARS.has(value[0])) return value;
  if (PLAIN_NUMBER.test(value) || looksLikePhone(value)) return value;
  return `'${value}`;
}

function escapeCsvCell(rawValue: unknown): string {
  const stringValue =
    rawValue === null || rawValue === undefined
      ? ""
      : typeof rawValue === "string"
        ? rawValue
        : JSON.stringify(rawValue);

  // A real number can't be a formula; only text is checked.
  const neutralized =
    typeof rawValue === "number" ? stringValue : neutralizeFormulaInjection(stringValue);
  const needsQuoting = /[",\n\r]/.test(neutralized);
  if (!needsQuoting) return neutralized;
  return `"${neutralized.replace(/"/g, '""')}"`;
}

/** Prepended to downloaded CSV files: without it Excel reads them as
 * the system's legacy encoding and garbles any non-ASCII text. */
export const CSV_BOM = "\uFEFF";

/**
 * Serializes rows to CSV, UTF-8, one response per row, stable column
 * order taken from `columns`. Multi-choice answers should already be
 * flattened by the caller into a single stable string representation
 * (e.g. semicolon-joined labels) before reaching this function.
 */
export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  if (rows.length > MAX_SYNCHRONOUS_EXPORT_ROWS) {
    throw new ExportTooLargeError(rows.length);
  }

  const header = columns.map(escapeCsvCell).join(",");
  const body = rows.map((row) => columns.map((col) => escapeCsvCell(row[col])).join(","));
  return [header, ...body].join("\r\n") + "\r\n";
}
