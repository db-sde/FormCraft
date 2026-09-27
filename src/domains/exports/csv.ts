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

/**
 * Guards against CSV/spreadsheet formula injection: a cell whose content
 * starts with a character a spreadsheet app would interpret as the start
 * of a formula gets a leading apostrophe/quote-neutralizing prefix so
 * Excel/Sheets renders it as literal text instead of executing it.
 */
function neutralizeFormulaInjection(value: string): string {
  if (value.length === 0) return value;
  return FORMULA_TRIGGER_CHARS.has(value[0]) ? `'${value}` : value;
}

function escapeCsvCell(rawValue: unknown): string {
  const stringValue =
    rawValue === null || rawValue === undefined
      ? ""
      : typeof rawValue === "string"
        ? rawValue
        : JSON.stringify(rawValue);

  const neutralized = neutralizeFormulaInjection(stringValue);
  const needsQuoting = /[",\n\r]/.test(neutralized);
  if (!needsQuoting) return neutralized;
  return `"${neutralized.replace(/"/g, '""')}"`;
}

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
