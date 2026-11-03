// fontkit's Indic shaper (Devanagari) expects this global.
import "regenerator-runtime/runtime";
import { readFileSync } from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { formatMoney } from "@/domains/forms/products";
import type { DocumentKind } from "./settings";

/**
 * Draws a document (master spec F-07) as a PDF with pdf-lib. Text is set
 * in Noto Sans, which ships split by script; each character is drawn with
 * the first file that has it (Latin, Latin Extended, Cyrillic, Greek,
 * Vietnamese, Devanagari), and only the files a document uses are
 * embedded, subset. Characters none of them cover (emoji, Chinese,
 * Japanese, Korean, Arabic…) become "?".
 */

export type DocumentContent = {
  kind: DocumentKind;
  heading: string;
  intro?: string;
  footer?: string;
  color: string;
  logo?: { bytes: Uint8Array; type: "png" | "jpg" };
  formTitle: string;
  numberLabel: string;
  issuedAt: string;
  rows: { label: string; value: string; signature?: Uint8Array }[];
  order?: {
    currency: string;
    lines: { label: string; quantity: number; unitAmount: number; amount: number }[];
    /** Lines between the items and the total (a coupon, as a negative). */
    adjustments?: { label: string; amount: number }[];
    total: number;
    /** What the order's payment state is, in words; "Paid" only when paid. */
    paymentLabel: string;
    paid: boolean;
  };
  certificate?: { name: string };
};

const SUBSETS = [
  "latin",
  "latin-ext",
  "cyrillic",
  "cyrillic-ext",
  "greek",
  "greek-ext",
  "vietnamese",
  "devanagari",
] as const;

const FONT_DIR = path.join(process.cwd(), "node_modules/@fontsource/noto-sans/files");

type FontFile = { bytes: Uint8Array; has: (cp: number) => boolean };
const fileCache = new Map<string, FontFile>();

function fontFile(subset: string, weight: 400 | 700): FontFile {
  const key = `${subset}-${weight}`;
  let file = fileCache.get(key);
  if (!file) {
    const bytes = new Uint8Array(
      readFileSync(path.join(FONT_DIR, `noto-sans-${subset}-${weight}-normal.woff`)),
    );
    const font = fontkit.create(Buffer.from(bytes));
    file = { bytes, has: (cp) => font.hasGlyphForCodePoint(cp) };
    fileCache.set(key, file);
  }
  return file;
}

/** Fonts for one document: embedded on first use. */
class FontStack {
  private embedded = new Map<string, PDFFont>();
  constructor(private doc: PDFDocument) {}

  private async font(subset: string, weight: 400 | 700): Promise<PDFFont> {
    const key = `${subset}-${weight}`;
    let font = this.embedded.get(key);
    if (!font) {
      font = await this.doc.embedFont(fontFile(subset, weight).bytes, { subset: true });
      this.embedded.set(key, font);
    }
    return font;
  }

  /** The text split into runs, each with a font that can draw it. */
  async runs(
    text: string,
    weight: 400 | 700,
  ): Promise<{ text: string; font: PDFFont }[]> {
    const out: { text: string; font: PDFFont }[] = [];
    let current: { text: string; subset: string } | null = null;
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      let subset: string | undefined = SUBSETS.find((s) => fontFile(s, weight).has(cp));
      let glyph = ch;
      if (!subset) {
        subset = "latin";
        glyph = /\s/.test(ch) ? " " : "?";
      }
      if (current && current.subset === subset) current.text += glyph;
      else {
        if (current)
          out.push({ text: current.text, font: await this.font(current.subset, weight) });
        current = { text: glyph, subset };
      }
    }
    if (current)
      out.push({ text: current.text, font: await this.font(current.subset, weight) });
    return out;
  }

  async width(text: string, size: number, weight: 400 | 700): Promise<number> {
    let w = 0;
    for (const run of await this.runs(text, weight))
      w += run.font.widthOfTextAtSize(run.text, size);
    return w;
  }
}

function hex(color: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!m) return rgb(0.1, 0.1, 0.1);
  return rgb(
    parseInt(m[1], 16) / 255,
    parseInt(m[2], 16) / 255,
    parseInt(m[3], 16) / 255,
  );
}

const INK = rgb(0.12, 0.11, 0.1);
const MUTED = rgb(0.42, 0.4, 0.38);
const LINE = rgb(0.86, 0.85, 0.83);

/** A page-flowing writer: wraps text and starts new pages as needed. */
class Writer {
  page!: PDFPage;
  y = 0;
  pages: PDFPage[] = [];
  constructor(
    private doc: PDFDocument,
    private fonts: FontStack,
    private size: [number, number],
    private margin: number,
    private bottom: number,
  ) {}

  get width() {
    return this.size[0] - this.margin * 2;
  }

  newPage() {
    this.page = this.doc.addPage(this.size);
    this.pages.push(this.page);
    this.y = this.size[1] - this.margin;
  }

  ensure(height: number) {
    if (this.y - height < this.bottom) this.newPage();
  }

  /** Words that fit in `width`, line by line (long words are broken). */
  async wrap(text: string, size: number, weight: 400 | 700, width = this.width) {
    const lines: string[] = [];
    for (const paragraph of text.split(/\r?\n/)) {
      let line = "";
      for (const word of paragraph.split(/(\s+)/)) {
        const attempt = line + word;
        if ((await this.fonts.width(attempt, size, weight)) <= width) {
          line = attempt;
          continue;
        }
        if (line.trim()) lines.push(line.trimEnd());
        line = word.trimStart();
        // A single word wider than the line: break it by characters.
        while ((await this.fonts.width(line, size, weight)) > width && line.length > 1) {
          let cut = line.length - 1;
          while (
            cut > 1 &&
            (await this.fonts.width(line.slice(0, cut), size, weight)) > width
          )
            cut -= 1;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      }
      lines.push(line.trimEnd());
    }
    return lines;
  }

  async drawLine(
    text: string,
    x: number,
    y: number,
    size: number,
    weight: 400 | 700,
    color = INK,
    page = this.page,
  ) {
    let cursor = x;
    for (const run of await this.fonts.runs(text, weight)) {
      page.drawText(run.text, { x: cursor, y, size, font: run.font, color });
      cursor += run.font.widthOfTextAtSize(run.text, size);
    }
  }

  async text(
    text: string,
    options: {
      size?: number;
      weight?: 400 | 700;
      color?: ReturnType<typeof rgb>;
      gap?: number;
    } = {},
  ) {
    const size = options.size ?? 11;
    const weight = options.weight ?? 400;
    const leading = size * 1.4;
    for (const line of await this.wrap(text, size, weight)) {
      this.ensure(leading);
      this.y -= leading;
      await this.drawLine(
        line,
        this.size[0] - this.margin - this.width,
        this.y + size * 0.3,
        size,
        weight,
        options.color ?? INK,
      );
    }
    this.y -= options.gap ?? 0;
  }

  image(image: PDFImage, maxWidth: number, maxHeight: number) {
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
    const w = image.width * scale;
    const h = image.height * scale;
    this.ensure(h + 6);
    this.y -= h + 6;
    this.page.drawImage(image, { x: this.margin, y: this.y, width: w, height: h });
  }

  rule() {
    this.ensure(12);
    this.y -= 8;
    this.page.drawLine({
      start: { x: this.margin, y: this.y },
      end: { x: this.size[0] - this.margin, y: this.y },
      thickness: 0.6,
      color: LINE,
    });
    this.y -= 4;
  }
}

async function embedImage(
  doc: PDFDocument,
  image: { bytes: Uint8Array; type: "png" | "jpg" },
) {
  try {
    return image.type === "png"
      ? await doc.embedPng(image.bytes)
      : await doc.embedJpg(image.bytes);
  } catch {
    return null;
  }
}

/** The PDF for a document. */
export async function renderDocumentPdf(content: DocumentContent): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`${content.heading} ${content.numberLabel}`);
  doc.setProducer("FormCraft");
  doc.setCreator("FormCraft");
  const fonts = new FontStack(doc);
  const accent = hex(content.color);
  const logo = content.logo ? await embedImage(doc, content.logo) : null;

  if (content.kind === "certificate") {
    await drawCertificate(doc, fonts, content, accent, logo);
    return doc.save();
  }

  const size: [number, number] = [595.28, 841.89]; // A4
  const margin = 50;
  const w = new Writer(doc, fonts, size, margin, 70);
  w.newPage();

  // Header: a band of the form's colour, the logo, heading and reference.
  w.page.drawRectangle({
    x: 0,
    y: size[1] - 8,
    width: size[0],
    height: 8,
    color: accent,
  });
  if (logo) {
    w.image(logo, 160, 44);
    w.y -= 10;
  }
  await w.text(content.heading, { size: 22, weight: 700, gap: 2 });
  await w.text(
    `${content.formTitle} · No. ${content.numberLabel} · ${content.issuedAt}`,
    {
      size: 9.5,
      color: MUTED,
      gap: 6,
    },
  );
  if (content.intro) await w.text(content.intro, { size: 11, gap: 4 });
  w.rule();

  if (content.order) {
    const o = content.order;
    const right = size[0] - margin;
    w.ensure(20);
    w.y -= 16;
    await w.drawLine("Item", margin, w.y, 9, 700, MUTED);
    await w.drawLine("Qty", right - 190, w.y, 9, 700, MUTED);
    await w.drawLine("Each", right - 140, w.y, 9, 700, MUTED);
    const amountHeader = "Amount";
    await w.drawLine(
      amountHeader,
      right - (await fonts.width(amountHeader, 9, 700)),
      w.y,
      9,
      700,
      MUTED,
    );
    for (const line of o.lines) {
      const labelLines = await w.wrap(line.label, 11, 400, w.width - 210);
      w.ensure(16 * labelLines.length + 4);
      w.y -= 16;
      for (let i = 0; i < labelLines.length; i += 1) {
        await w.drawLine(labelLines[i], margin, w.y - i * 15, 11, 400);
      }
      await w.drawLine(String(line.quantity), right - 190, w.y, 11, 400);
      await w.drawLine(
        formatMoney(line.unitAmount, o.currency),
        right - 140,
        w.y,
        11,
        400,
      );
      const amount = formatMoney(line.amount, o.currency);
      await w.drawLine(
        amount,
        right - (await fonts.width(amount, 11, 400)),
        w.y,
        11,
        400,
      );
      w.y -= (labelLines.length - 1) * 15;
    }
    for (const adj of o.adjustments ?? []) {
      w.ensure(18);
      w.y -= 16;
      await w.drawLine(adj.label, margin, w.y, 11, 400, MUTED);
      const amount =
        adj.amount < 0
          ? `−${formatMoney(-adj.amount, o.currency)}`
          : formatMoney(adj.amount, o.currency);
      await w.drawLine(
        amount,
        right - (await fonts.width(amount, 11, 400)),
        w.y,
        11,
        400,
        MUTED,
      );
    }
    w.rule();
    w.ensure(22);
    w.y -= 18;
    await w.drawLine(content.kind === "receipt" ? "Paid" : "Total", margin, w.y, 13, 700);
    const total = formatMoney(o.total, o.currency);
    await w.drawLine(total, right - (await fonts.width(total, 13, 700)), w.y, 13, 700);
    w.y -= 8;
    await w.text(o.paymentLabel, {
      size: 10.5,
      weight: 700,
      color: o.paid ? rgb(0.1, 0.45, 0.25) : MUTED,
      gap: 10,
    });
  }

  for (const row of content.rows) {
    w.ensure(30);
    w.y -= 6;
    await w.text(row.label, { size: 9.5, weight: 700, color: MUTED });
    if (row.signature) {
      const image = await embedImage(doc, { bytes: row.signature, type: "png" });
      if (image) w.image(image, 220, 74);
      await w.text(row.value, { size: 9, color: MUTED, gap: 4 });
    } else {
      await w.text(row.value || "—", { size: 11, gap: 4 });
    }
  }

  // Footer on every page: the creator's text and page numbers.
  const total = w.pages.length;
  for (let i = 0; i < total; i += 1) {
    const page = w.pages[i];
    const label = `Page ${i + 1} of ${total}`;
    await w.drawLine(
      label,
      size[0] - margin - (await fonts.width(label, 8.5, 400)),
      34,
      8.5,
      400,
      MUTED,
      page,
    );
    if (content.footer) {
      const [first] = await w.wrap(content.footer, 8.5, 400, w.width - 90);
      await w.drawLine(first ?? "", margin, 34, 8.5, 400, MUTED, page);
    }
  }
  return doc.save();
}

async function drawCertificate(
  doc: PDFDocument,
  fonts: FontStack,
  content: DocumentContent,
  accent: ReturnType<typeof rgb>,
  logo: PDFImage | null,
) {
  const size: [number, number] = [841.89, 595.28]; // A4 landscape
  const page = doc.addPage(size);
  page.drawRectangle({
    x: 24,
    y: 24,
    width: size[0] - 48,
    height: size[1] - 48,
    borderColor: accent,
    borderWidth: 3,
  });
  page.drawRectangle({
    x: 34,
    y: 34,
    width: size[0] - 68,
    height: size[1] - 68,
    borderColor: LINE,
    borderWidth: 1,
  });
  const w = new Writer(doc, fonts, size, 90, 60);
  w.page = page;
  const centre = async (
    text: string,
    y: number,
    sz: number,
    weight: 400 | 700,
    color = INK,
  ) => {
    const lines = await w.wrap(text, sz, weight, size[0] - 220);
    let cursor = y;
    for (const line of lines) {
      const width = await fonts.width(line, sz, weight);
      await w.drawLine(line, (size[0] - width) / 2, cursor, sz, weight, color, page);
      cursor -= sz * 1.3;
    }
    return cursor;
  };
  if (logo) {
    const scale = Math.min(160 / logo.width, 50 / logo.height, 1);
    page.drawImage(logo, {
      x: (size[0] - logo.width * scale) / 2,
      y: size[1] - 110,
      width: logo.width * scale,
      height: logo.height * scale,
    });
  }
  let y = size[1] - 170;
  y = await centre(content.heading, y, 30, 700, accent);
  y = await centre(content.intro || "This certifies that", y - 18, 13, 400, MUTED);
  y = await centre(content.certificate?.name || "—", y - 22, 34, 700);
  y = await centre(`completed ${content.formTitle}`, y - 16, 14, 400, MUTED);
  await centre(
    `${content.issuedAt} · No. ${content.numberLabel}`,
    y - 30,
    11,
    400,
    MUTED,
  );
  if (content.footer) await centre(content.footer, 70, 9, 400, MUTED);
}
