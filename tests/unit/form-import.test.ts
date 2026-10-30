import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildImportedSchema,
  ImportError,
  importFromUrl,
  importTarget,
} from "@/domains/forms/import";
import {
  extractGoogleData,
  isGoogleSignIn,
  parseGoogleForm,
} from "@/domains/forms/import/google";
import { findTypeformDefinition, parseTypeform } from "@/domains/forms/import/typeform";
import { validateSemantics } from "@/domains/forms/schema/validate";

/**
 * Form import (master spec F-05), against saved public-form fixtures:
 * what's imported, converted or left out; logic rebuilt only where it
 * can be; private and unsupported links refused with a message.
 */

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, "../fixtures/import", name), "utf8");
const googleHtml = fixture("google-form.html");
const typeformJson = JSON.parse(fixture("typeform.json")) as Record<string, unknown>;

function response(status: number, body = "", location?: string): Response {
  return new Response(status >= 300 && status < 400 ? null : body, {
    status,
    headers: location ? { location } : {},
  });
}

describe("which links can be imported", () => {
  it("accepts Google Forms and Typeform links, normalized", () => {
    expect(
      importTarget("https://docs.google.com/forms/d/e/1FAIpQLSabc/viewform?usp=sf_link"),
    ).toEqual({
      kind: "google_forms",
      url: "https://docs.google.com/forms/d/e/1FAIpQLSabc/viewform",
    });
    expect(importTarget("https://forms.gle/AbC123")).toEqual({
      kind: "google_short",
      url: "https://forms.gle/AbC123",
    });
    expect(importTarget("https://acme.typeform.com/to/xYz789?utm=1")).toMatchObject({
      kind: "typeform",
      id: "xYz789",
    });
  });

  it("refuses anything else with what to paste", () => {
    for (const bad of [
      "not a url",
      "https://example.com/forms/d/e/x/viewform",
      "http://localhost:3000/f/x",
      "https://docs.google.com/document/d/abc",
      "javascript:alert(1)",
      "https://evil.typeform.com.example.com/to/x",
    ]) {
      expect(importTarget(bad)).toHaveProperty("error");
    }
  });
});

describe("Google Forms", () => {
  const data = extractGoogleData(googleHtml)!;
  const { schema, report } = buildImportedSchema(parseGoogleForm(data), {
    kind: "google_forms",
    url: "https://docs.google.com/forms/d/e/x/viewform",
  });
  const byLabel = (label: string) => schema.questions.find((q) => q.label === label);

  it("brings over questions, options and required flags", () => {
    expect(schema.meta.title).toBe("Event signup");
    expect(schema.meta.layout).toBe("classic");
    expect(schema.questions[0]).toMatchObject({
      type: "welcome_screen",
      description: "Tell us if you're coming.",
    });
    expect(byLabel("Your name")).toMatchObject({ type: "short_text", required: true });
    expect(byLabel("Email")?.type).toBe("email");
    const attending = byLabel("Attending?");
    expect(attending).toMatchObject({ type: "single_select", required: true });
    expect(
      (attending?.settings as { options: { label: string }[] }).options.map(
        (o) => o.label,
      ),
    ).toEqual(["Yes", "No", "Maybe"]);
    expect(byLabel("Diet")).toMatchObject({
      type: "multi_select",
      settings: { allowOther: true },
    });
    // Markup in titles is dropped.
    expect(byLabel("Rate the venue")).toMatchObject({
      type: "opinion_scale",
      settings: { min: 1, max: 5, leftLabel: "Bad", rightLabel: "Great" },
    });
    expect(byLabel("Grid")).toMatchObject({ type: "matrix" });
    expect(byLabel("When")?.type).toBe("datetime");
    expect(schema.questions.some((q) => q.type === "page_break")).toBe(true);
    expect(() => validateSemantics(schema)).not.toThrow();
  });

  it("reports each field as imported, converted or left out", () => {
    const status = Object.fromEntries(report.fields.map((f) => [f.label, f.status]));
    expect(status).toMatchObject({
      "Your name": "imported",
      Email: "converted",
      Logo: "unknown",
      Duration: "unknown",
      Details: "converted",
    });
    expect(report.notes.join(" ")).toMatch(/none are imported/);
  });

  it("rebuilds forward jumps and says which it couldn't", () => {
    // "No" → submit, "Maybe" → the Details page, page 1 → submit.
    expect(report.logic.imported).toBe(3);
    expect(schema.rules).toHaveLength(3);
    expect(report.logic.notes.join(" ")).toMatch(/goes back to an earlier question/);
  });

  it("recognises Google's sign-in wall", () => {
    expect(
      isGoogleSignIn('<a href="https://accounts.google.com/ServiceLogin?continue=x">'),
    ).toBe(true);
    expect(isGoogleSignIn(googleHtml)).toBe(false);
    expect(extractGoogleData("<html>nothing</html>")).toBeNull();
  });
});

describe("Typeform", () => {
  const { schema, report } = buildImportedSchema(parseTypeform(typeformJson), {
    kind: "typeform",
    url: "https://form.typeform.com/to/abc123",
  });
  const byLabel = (label: string) => schema.questions.find((q) => q.label === label);

  it("maps fields, screens and endings", () => {
    expect(schema.meta.layout).toBe("conversational");
    expect(schema.questions[0]).toMatchObject({
      type: "welcome_screen",
      label: "Hi there",
      settings: { buttonLabel: "Go" },
    });
    expect(byLabel("Name?")).toMatchObject({
      type: "short_text",
      required: true,
      settings: { maxLength: 80 },
    });
    expect(byLabel("Recommend us?")).toMatchObject({
      type: "opinion_scale",
      settings: { min: 0, max: 10 },
    });
    expect(byLabel("About you")?.type).toBe("statement");
    expect(byLabel("Age")).toMatchObject({
      type: "number",
      settings: { min: 0, max: 120 },
    });
    expect(byLabel("Agree?")?.type).toBe("yes_no");
    // The default thank-you screen is the default ending.
    expect(schema.endings.map((e) => [e.title, e.isDefault])).toEqual([
      ["Thanks", true],
      ["Glad!", false],
    ]);
    expect(report.fields.find((f) => f.label === "Pay")).toMatchObject({
      status: "unknown",
    });
  });

  it("rebuilds choice jumps only, and lists the rest", () => {
    expect(report.logic.imported).toBe(2);
    const jumps = schema.rules!.map((r) => r.then[0]);
    expect(jumps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "jump_to_ending", endingId: "ending_2" }),
        expect.objectContaining({
          type: "jump_to_question",
          questionId: byLabel("Why not?")!.id,
        }),
      ]),
    );
    const notes = report.logic.notes.join(" ");
    expect(notes).toMatch(/variables \(score\)/);
    expect(notes).toMatch(/“add” action/);
    expect(notes).toMatch(/goes back/);
  });

  it("finds the definition inside a renderer payload", () => {
    expect(
      findTypeformDefinition({ props: { pageProps: { form: typeformJson } } })?.title,
    ).toBe("Feedback");
    expect(findTypeformDefinition({ nothing: true })).toBeNull();
  });
});

describe("fetching", () => {
  it("follows forms.gle to the form and imports it", async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.startsWith("https://forms.gle/")
        ? response(302, "", "https://docs.google.com/forms/d/e/1FAIpQ/viewform")
        : response(200, googleHtml),
    );
    const { schema, report } = await importFromUrl("https://forms.gle/abc", fetcher);
    expect(report.sourceUrl).toBe("https://docs.google.com/forms/d/e/1FAIpQ/viewform");
    expect(schema.meta.title).toBe("Event signup");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("explains a form that asks people to sign in", async () => {
    const fetcher = async () =>
      response(302, "", "https://accounts.google.com/v3/signin/identifier?continue=x");
    await expect(
      importFromUrl("https://docs.google.com/forms/d/e/1FAIpQ/viewform", fetcher),
    ).rejects.toThrow(/isn't public/);
  });

  it("never follows a redirect off Google", async () => {
    const fetcher = vi.fn(async () => response(302, "", "http://169.254.169.254/"));
    await expect(
      importFromUrl("https://docs.google.com/forms/d/e/1FAIpQ/viewform", fetcher),
    ).rejects.toBeInstanceOf(ImportError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reads a typeform from its page's embedded data", async () => {
    const page = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
      { props: { pageProps: { form: typeformJson } } },
    )}</script></html>`;
    const { schema } = await importFromUrl(
      "https://acme.typeform.com/to/abc123",
      async () => response(200, page),
    );
    expect(schema.meta.title).toBe("Feedback");
  });

  it("says when a typeform can't be read", async () => {
    await expect(
      importFromUrl("https://acme.typeform.com/to/abc123", async () =>
        response(200, "<html></html>"),
      ),
    ).rejects.toThrow(/couldn't be read/);
  });
});
