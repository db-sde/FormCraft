import { describe, expect, it } from "vitest";
import { slugify } from "@/domains/workspaces";

describe("slugify", () => {
  it("lowercases and dashes spaces", () => {
    expect(slugify("Acme Corp")).toBe("acme-corp");
  });

  it("strips diacritics", () => {
    expect(slugify("Café Résumé")).toBe("cafe-resume");
  });

  it("falls back to 'workspace' for empty/symbol-only input", () => {
    expect(slugify("!!!")).toBe("workspace");
  });

  it("collapses repeated separators and trims edges", () => {
    expect(slugify("  --Hello   World--  ")).toBe("hello-world");
  });
});
