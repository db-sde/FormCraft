import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { columnLetter, toXlsx } from "@/domains/exports/xlsx";

/** Reads a zip's files back (local headers, deflate). */
function unzip(bytes: Uint8Array): Record<string, string> {
  const buf = Buffer.from(bytes);
  const files: Record<string, string> = {};
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const size = buf.readUInt32LE(at + 18);
    const nameLength = buf.readUInt16LE(at + 26);
    const extra = buf.readUInt16LE(at + 28);
    const name = buf.subarray(at + 30, at + 30 + nameLength).toString("utf8");
    const start = at + 30 + nameLength + extra;
    files[name] = inflateRawSync(buf.subarray(start, start + size)).toString("utf8");
    at = start + size;
  }
  return files;
}

// QA EN-02: responses and leads as an Excel workbook.
describe("Excel export", () => {
  const xlsx = toXlsx(
    ["Submitted at", "Name", "score"],
    [
      { "Submitted at": "2026-10-24T10:00:00Z", Name: "Café <crème> & co", score: 10 },
      {
        "Submitted at": "2026-10-24T11:00:00Z",
        Name: '=HYPERLINK("http://x")',
        score: null,
      },
    ],
    "Responses",
  );
  const files = unzip(xlsx);

  it("is a workbook with one sheet", () => {
    expect(Object.keys(files).sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
    ]);
    expect(files["xl/workbook.xml"]).toContain('<sheet name="Responses"');
  });

  it("writes text safely and numbers as numbers", () => {
    const sheet = files["xl/worksheets/sheet1.xml"];
    expect(sheet).toContain("Café &lt;crème&gt; &amp; co");
    expect(sheet).toContain('<c r="C2"><v>10</v></c>');
    // A formula typed by a respondent stays text: never a <f> cell.
    expect(sheet).toContain("=HYPERLINK(&quot;http://x&quot;)");
    expect(sheet).not.toContain("<f>");
    // Empty values leave the cell out.
    expect(sheet).not.toContain('r="C3"');
  });

  it("names columns past Z", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnLetter)).toEqual([
      "A",
      "Z",
      "AA",
      "AB",
      "ZZ",
      "AAA",
    ]);
  });
});

it("drops characters XML can't hold", () => {
  const sheet = unzipSheet(toXlsx(["A"], [{ A: "a\u0001b\uFFFEc\tz" }]));
  expect(sheet).toContain(">abc\tz<");
});

function unzipSheet(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes);
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const size = buf.readUInt32LE(at + 18);
    const nameLength = buf.readUInt16LE(at + 26);
    const name = buf.subarray(at + 30, at + 30 + nameLength).toString("utf8");
    const start = at + 30 + nameLength + buf.readUInt16LE(at + 28);
    if (name === "xl/worksheets/sheet1.xml") {
      return inflateRawSync(buf.subarray(start, start + size)).toString("utf8");
    }
    at = start + size;
  }
  return "";
}
