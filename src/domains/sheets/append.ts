const DEFAULT_SHEETS_API_BASE = "https://sheets.googleapis.com";

export class SheetsApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "SheetsApiError";
  }
}

/** Appends one row to the end of a spreadsheet's first sheet via the
 * Sheets API `values.append` endpoint (USER_ENTERED so Google parses
 * dates/numbers the same way typing them in by hand would, matching
 * what a creator expects to see). `apiBase` is overridable so this can
 * be exercised against a local fake server for live verification
 * without a real Google Cloud project (see DECISIONS.md). */
export async function appendRowToSheet(
  accessToken: string,
  spreadsheetId: string,
  values: string[],
  apiBase = DEFAULT_SHEETS_API_BASE,
): Promise<void> {
  const url = `${apiBase}/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: [values] }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SheetsApiError(
      `Sheets API append failed: HTTP ${res.status} ${text}`,
      res.status,
    );
  }
}
