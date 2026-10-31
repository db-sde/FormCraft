import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { renderDocumentPdf } from "@/domains/documents/pdf";
import { documentApplies, paymentLabel } from "@/domains/documents/issue";
import {
  certificateHasRule,
  documentNumber,
  parseDocumentSettings,
} from "@/domains/documents/settings";
import { cleanAddress, cleanSubject } from "@/domains/notifications/mailer";
import { ruleMatches, ruleSubject } from "@/domains/notifications/rules";
import { dayWindow, localDate, previousDay } from "@/domains/notifications/digest";
import {
  buildSdkSnippet,
  EMBED_SDK_SOURCE,
  parseTrigger,
} from "@/domains/forms/embed-sdk";
import { pixelSnippets, safeAdIds, trackFunction } from "@/app/f/[slug]/pixels";
import { buildCsp } from "@/lib/http/csp";
import type { ResponseContext } from "@/domains/responses/context";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";

const schema = {
  schemaVersion: 1,
  meta: { title: "Quiz" },
  theme: {
    primaryColor: "#1d4ed8",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [
    { id: "pass", title: "Passed", isDefault: true },
    { id: "fail", title: "Try again", isDefault: false },
  ],
  questions: [
    {
      id: "q_name",
      type: "short_text",
      order: 0,
      label: "Name",
      required: false,
      settings: {},
    },
  ],
  logic: [],
  variables: [{ id: "v_score", name: "score", type: "number" }],
} as unknown as FormSchemaV1;

function ctx(overrides: Partial<ResponseContext> = {}): ResponseContext {
  return {
    id: "r1",
    status: "completed",
    completedAt: "2026-10-30T10:00:00.000Z",
    form: { id: "f1", title: "Quiz", workspaceId: "w1" },
    schema,
    answers: { q_name: "Ada\r\nBcc: evil@example.com" },
    hidden: {},
    path: schema.questions,
    variables: { v_score: 85 },
    endingId: "pass",
    today: "2026-10-30",
    uploads: new Map(),
    order: null,
    payment: null,
    ...overrides,
  };
}

const atLeast80 = {
  type: "compare" as const,
  left: { type: "variable" as const, variableId: "v_score" },
  op: "gte" as const,
  right: { type: "literal" as const, value: 80 },
};

describe("documents (F-07)", () => {
  it("issues a certificate only when its rule holds, and never without a rule", () => {
    expect(certificateHasRule({})).toBe(false);
    expect(documentApplies("certificate", {}, ctx())).toBe(false);
    expect(documentApplies("certificate", { condition: atLeast80 }, ctx())).toBe(true);
    expect(
      documentApplies(
        "certificate",
        { condition: atLeast80 },
        ctx({ variables: { v_score: 79 } }),
      ),
    ).toBe(false);
    expect(documentApplies("certificate", { endingIds: ["pass"] }, ctx())).toBe(true);
    expect(
      documentApplies(
        "certificate",
        { endingIds: ["pass"], condition: atLeast80 },
        ctx({ endingId: "fail" }),
      ),
    ).toBe(false);
    expect(documentApplies("summary", {}, ctx({ status: "partial" }))).toBe(false);
  });

  it("makes an order confirmation only for an order, and never calls it paid unless it is", () => {
    expect(documentApplies("order", {}, ctx())).toBe(false);
    expect(
      documentApplies(
        "order",
        {},
        ctx({
          order: {
            currency: "USD",
            lines: [{ itemId: "a", label: "A", unitAmount: 1, quantity: 1, amount: 1 }],
            total: 1,
          },
        }),
      ),
    ).toBe(true);
    expect(paymentLabel({ status: "paid" })).toEqual({ label: "Paid", paid: true });
    for (const status of ["pending", "failed", "expired"]) {
      expect(paymentLabel({ status }).paid).toBe(false);
      expect(paymentLabel({ status }).label).not.toBe("Paid");
    }
    expect(paymentLabel(null)).toEqual({ label: "Not paid online", paid: false });
  });

  it("numbers with the prefix and drops bad settings", () => {
    expect(documentNumber({ numberPrefix: "INV-" }, 42)).toBe("INV-0042");
    expect(documentNumber({}, 12345)).toBe("12345");
    expect(parseDocumentSettings({ numberPrefix: "bad prefix!" })).toEqual({});
  });

  it("renders a long, multi-script response to a multi-page PDF", async () => {
    const pdf = await renderDocumentPdf({
      kind: "summary",
      heading: "Response summary",
      color: "#1d4ed8",
      formTitle: "Quiz",
      numberLabel: "R-0001",
      issuedAt: "30 October 2026",
      footer: "Acme",
      rows: [
        { label: "Name", value: "Ада · नमस्ते · Ελένη" },
        { label: "Notes", value: "Long answer ".repeat(900) },
      ],
    });
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    const cert = await PDFDocument.load(
      await renderDocumentPdf({
        kind: "certificate",
        heading: "Certificate",
        color: "#b45309",
        formTitle: "Quiz",
        numberLabel: "C-0001",
        issuedAt: "30 October 2026",
        rows: [],
        certificate: { name: "Grace Hopper" },
      }),
    );
    const [page] = cert.getPages();
    expect(page.getWidth()).toBeGreaterThan(page.getHeight()); // landscape
  });
});

describe("notification rules (F-25)", () => {
  it("fires on its condition only", () => {
    expect(ruleMatches({ enabled: true }, ctx())).toBe(true);
    expect(ruleMatches({ enabled: false }, ctx())).toBe(false);
    expect(
      ruleMatches(
        { enabled: true, condition: atLeast80 },
        ctx({ variables: { v_score: 10 } }),
      ),
    ).toBe(false);
  });

  it("fills merge variables into a one-line subject that can't add headers", () => {
    const subject = ruleSubject("{{form}}: {{answer:q_name}} scored {{score}}", ctx());
    expect(subject).toBe("Quiz: Ada Bcc: evil@example.com scored 85");
    expect(subject).not.toMatch(/[\r\n]/);
    expect(ruleSubject(undefined, ctx())).toBe("New response: Quiz");
    expect(cleanSubject("a\u0000b\tc")).toBe("a b c");
  });

  it("accepts one well-formed address, never a list", () => {
    expect(cleanAddress(" Ada@Example.com ")).toBe("ada@example.com");
    expect(cleanAddress("a@example.com, b@example.com")).toBeNull();
    expect(cleanAddress("a@example.com\nBcc: b@example.com")).toBeNull();
    expect(cleanAddress(42)).toBeNull();
  });
});

describe("daily digest (F-25)", () => {
  it("covers the previous local day, daylight saving included", () => {
    // 03:40 UTC on 2 Nov 2026 is still 1 Nov in New York.
    const run = Date.UTC(2026, 10, 2, 3, 40);
    expect(localDate(run, "America/New_York")).toBe("2026-11-01");
    expect(previousDay("2026-11-01")).toBe("2026-10-31");
    expect(localDate(run, "Asia/Kolkata")).toBe("2026-11-02");
    // 1 Nov 2026 in New York is 25 hours long (clocks go back).
    const window = dayWindow("2026-11-01", "America/New_York");
    expect(window.from).toBe("2026-11-01T04:00:00.000Z");
    expect(window.to).toBe("2026-11-02T05:00:00.000Z");
    expect(dayWindow("2026-10-30", "UTC")).toEqual({
      from: "2026-10-30T00:00:00.000Z",
      to: "2026-10-31T00:00:00.000Z",
    });
  });
});

describe("embed SDK (F-24)", () => {
  it("parses triggers safely", () => {
    expect(parseTrigger("delay:5")).toEqual({ kind: "delay", seconds: 5 });
    expect(parseTrigger("delay:999")).toEqual({ kind: "delay", seconds: 120 });
    expect(parseTrigger("delay:9999")).toEqual({ kind: "click" });
    expect(parseTrigger("scroll:150")).toEqual({ kind: "scroll", percent: 100 });
    expect(parseTrigger("alert(1)")).toEqual({ kind: "click" });
  });

  it("builds a snippet that can't be broken out of", () => {
    const code = buildSdkSnippet({
      origin: "https://app.example",
      slug: "apply",
      mode: "popup",
      trigger: { kind: "delay", seconds: 3 },
      label: '"><script>alert(1)</script>',
      color: "red;background:url(x)",
    });
    expect(code).toContain('data-trigger="delay:3"');
    expect(code).not.toContain("<script>alert");
    expect(code).not.toContain("url(x)");
    expect(code).toContain('src="https://app.example/api/embed/sdk.js"');
  });

  it("ships valid JavaScript that only frames this app's form pages", () => {
    expect(() => new Function(EMBED_SDK_SOURCE)).not.toThrow();
    expect(EMBED_SDK_SOURCE).toContain('origin + "/f/" + slug');
    expect(EMBED_SDK_SOURCE).toContain("SLUG.test");
  });
});

describe("pixels (F-44)", () => {
  it("only accepts exact ids", () => {
    expect(
      safeAdIds({
        ga: null,
        gtm: null,
        meta: null,
        linkedin: "1234567",
        tiktok: "C4ABCDEFGHIJKLMNOPQR",
      }),
    ).toEqual({
      linkedin: "1234567",
      linkedinConversion: null,
      tiktok: "C4ABCDEFGHIJKLMNOPQR",
    });
    const bad = pixelSnippets({
      ga: null,
      gtm: null,
      meta: null,
      linkedin: "1');x('",
      tiktok: "x",
    });
    expect(bad).toEqual([]);
  });

  it("sends each start and submit once, LinkedIn only with a conversion id", () => {
    const calls: unknown[][] = [];
    const win: Record<string, unknown> = {
      fbq: (...a: unknown[]) => calls.push(["fbq", ...a]),
      lintrk: (...a: unknown[]) => calls.push(["lintrk", ...a]),
      ttq: { track: (...a: unknown[]) => calls.push(["ttq", ...a]) },
    };
    const run = new Function(
      "window",
      "location",
      `${trackFunction({ ga: null, gtm: null, meta: "1234567", linkedin: "1234567", linkedinConversion: "998877", tiktok: null })} return window.formcraftTrack;`,
    );
    const track = run(win, { search: "" }) as (e: string) => void;
    track("submit");
    track("submit");
    track("start");
    expect(calls).toEqual([
      ["fbq", "track", "Lead"],
      ["lintrk", "track", { conversion_id: 998877 }],
      ["ttq", "SubmitForm"],
      ["ttq", "FormStart"],
    ]);
  });

  it("allows the new vendors on public forms only", () => {
    const parse = (csp: string) =>
      Object.fromEntries(
        csp
          .split(";")
          .map((d) => d.trim().split(/\s+/))
          .map(([k, ...v]) => [k, v]),
      );
    const form = parse(
      buildCsp({ nonce: "n", supabaseUrl: "https://x.supabase.co", publicForm: true }),
    );
    expect(form["script-src"]).toEqual(
      expect.arrayContaining(["https://snap.licdn.com", "https://analytics.tiktok.com"]),
    );
    const app = parse(
      buildCsp({ nonce: "n", supabaseUrl: "https://x.supabase.co", publicForm: false }),
    );
    expect(app["script-src"]).not.toContain("https://snap.licdn.com");
  });
});
