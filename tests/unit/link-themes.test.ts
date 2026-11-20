import { describe, expect, it } from "vitest";
import { parseFormSchema } from "@/domains/forms/schema";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  saveLookAsVariant,
  themeForLink,
  themeVariantId,
} from "@/domains/themes/variants";
import { buildSdkSnippet } from "@/domains/forms/embed-sdk";
import { buildEmbedSnippet } from "@/domains/forms/embed";

/** Link themes (F-66). */
const base = parseFormSchema({
  schemaVersion: 1,
  meta: { title: "Themes" },
  theme: {
    primaryColor: "#111111",
    backgroundColor: "#ffffff",
    customCss: "h1 { color: red; }",
  },
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    {
      id: "q1",
      type: "short_text",
      order: 0,
      label: "Name",
      required: false,
      settings: {},
    },
  ],
  logic: [],
  themeVariants: [
    {
      id: "dark",
      name: "Dark",
      theme: {
        primaryColor: "#fbbf24",
        backgroundColor: "#111827",
        textColor: "#f9fafb",
      },
    },
  ],
}) as FormSchemaV1;

describe("link themes (F-66)", () => {
  it("picks a saved look by id, keeping the form's own custom CSS", () => {
    const theme = themeForLink(base, "dark");
    expect(theme.backgroundColor).toBe("#111827");
    expect(theme.customCss).toBe("h1 { color: red; }");
  });

  it("falls back to the main look for anything else", () => {
    for (const raw of [
      "light",
      "",
      "DARK",
      "dark;color:red",
      "<script>",
      ["dark"],
      undefined,
    ]) {
      expect(themeForLink(base, raw).backgroundColor).toBe("#ffffff");
    }
  });

  it("refuses two looks with the same id and ids a link couldn't carry", () => {
    const twice = {
      ...base,
      themeVariants: [...base.themeVariants!, ...base.themeVariants!],
    };
    expect(() => parseFormSchema(twice)).toThrow();
    const bad = {
      ...base,
      themeVariants: [{ ...base.themeVariants![0], id: "Dark Mode" }],
    };
    expect(() => parseFormSchema(bad)).toThrow();
  });

  it("names a new look from its title, numbered when taken", () => {
    expect(themeVariantId("Dark mode!", [])).toBe("dark-mode");
    expect(themeVariantId("Dark", base.themeVariants!)).toBe("dark-2");
    expect(themeVariantId("★", [])).toBe("theme");
    const saved = saveLookAsVariant(base.theme, " Brand ", []);
    expect(saved).toMatchObject({ id: "brand", name: "Brand" });
    expect(saved.theme).not.toHaveProperty("customCss");
  });

  it("carries a well-formed id into embed code, and nothing else", () => {
    expect(
      buildSdkSnippet({
        origin: "https://x.test",
        slug: "f",
        mode: "inline",
        theme: "dark",
      }),
    ).toContain('data-theme="dark"');
    expect(
      buildSdkSnippet({
        origin: "https://x.test",
        slug: "f",
        mode: "inline",
        theme: '"><b>',
      }),
    ).not.toContain("data-theme");
    expect(
      buildEmbedSnippet({
        formUrl: "https://x.test/f/f",
        formId: "id",
        title: "T",
        theme: "dark",
      }),
    ).toContain("?embed=1&theme=dark");
  });
});
