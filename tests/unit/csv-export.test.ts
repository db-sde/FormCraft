import { describe, expect, it } from "vitest";
import {
  toCsv,
  ExportTooLargeError,
  MAX_SYNCHRONOUS_EXPORT_ROWS,
  neutralizeFormulaInjection,
} from "@/domains/exports";

describe("toCsv", () => {
  it("serializes basic rows with a header", () => {
    const csv = toCsv(["name", "email"], [{ name: "Ada", email: "ada@example.com" }]);
    expect(csv).toBe("name,email\r\nAda,ada@example.com\r\n");
  });

  it("quotes cells containing commas, quotes, or newlines", () => {
    const csv = toCsv(["note"], [{ note: 'Hello, "world"\nnew line' }]);
    expect(csv).toContain('"Hello, ""world""\nnew line"');
  });

  it("neutralizes formula-injection payloads", () => {
    const csv = toCsv(["answer"], [{ answer: "=cmd|'/c calc'!A0" }]);
    const [, dataLine] = csv.split("\r\n");
    expect(dataLine.startsWith("'=")).toBe(true);
  });

  it("handles null/undefined as empty cells", () => {
    const csv = toCsv(["a", "b"], [{ a: null, b: undefined }]);
    expect(csv).toBe("a,b\r\n,\r\n");
  });

  it("throws ExportTooLargeError above the synchronous bound instead of truncating", () => {
    const rows = Array.from({ length: MAX_SYNCHRONOUS_EXPORT_ROWS + 1 }, (_, i) => ({
      id: i,
    }));
    expect(() => toCsv(["id"], rows)).toThrow(ExportTooLargeError);
  });
});

describe("neutralizeFormulaInjection", () => {
  it("prefixes anything a spreadsheet would run as a formula", () => {
    for (const value of [
      "=1+1",
      "+cmd",
      "-cmd",
      "@SUM(A1)",
      "\tx",
      "\rx",
      '=HYPERLINK("u")',
    ]) {
      expect(neutralizeFormulaInjection(value), value).toBe(`'${value}`);
    }
  });

  it("leaves ordinary text and plain numbers alone", () => {
    for (const value of [
      "",
      "Ada",
      "5",
      "-5",
      "+5",
      "-5.25",
      "a=b",
      "2026-09-30",
      " leading",
    ]) {
      expect(neutralizeFormulaInjection(value), value).toBe(value);
    }
  });
});
