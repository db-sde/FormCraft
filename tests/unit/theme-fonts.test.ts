import { describe, expect, it } from "vitest";
import { isAllowedFontUrl, isWoff2, themeForPlan } from "@/domains/themes/fonts";
import { FONT_LIBRARY, findLibraryFont } from "@/domains/themes/font-library";
import { themeFontStack } from "@/components/theme-styles";
import { THEME_PRESETS, contrastRatio } from "@/domains/themes";

const SUPABASE = "https://abc.supabase.co";
const base = {
  primaryColor: "#000000",
  backgroundColor: "#ffffff",
  fontFamily: "inter" as const,
  buttonStyle: "rounded" as const,
};
const ok = `${SUPABASE}/storage/v1/object/public/theme-assets/ws-1/fonts/abc-123.woff2`;

describe("theme fonts (P2.22)", () => {
  it("only accept our own storage, plain paths and .woff2", () => {
    expect(isAllowedFontUrl(ok, SUPABASE)).toBe(true);
    expect(isAllowedFontUrl("https://evil.example/font.woff2", SUPABASE)).toBe(false);
    expect(isAllowedFontUrl(`${ok}") ; } body{display:none`, SUPABASE)).toBe(false);
    expect(isAllowedFontUrl(ok.replace(".woff2", ".ttf"), SUPABASE)).toBe(false);
    expect(isAllowedFontUrl(ok, undefined)).toBe(false);
  });

  it("keep built-in and library fonts on every plan (pricing doc)", () => {
    expect(
      themeForPlan({ ...base, fontFamily: "lora" }, false, SUPABASE).fontFamily,
    ).toBe("lora");
    expect(
      themeForPlan(
        { ...base, fontFamily: "library", libraryFont: "Fraunces" },
        false,
        SUPABASE,
      ),
    ).toMatchObject({ fontFamily: "library", libraryFont: "Fraunces" });
  });

  it("show Inter for a library name that isn't safe in CSS", () => {
    expect(
      themeForPlan(
        { ...base, fontFamily: "library", libraryFont: 'x"; color: red' },
        true,
        SUPABASE,
      ),
    ).toMatchObject({ fontFamily: "inter", libraryFont: undefined });
    expect(
      themeForPlan({ ...base, fontFamily: "library" }, true, SUPABASE).fontFamily,
    ).toBe("inter");
    expect(
      themeForPlan({ ...base, headingFont: "bad;name" } as never, true, SUPABASE),
    ).toMatchObject({ headingFont: undefined });
  });

  it("show Inter for an uploaded font the plan doesn't include", () => {
    const custom = {
      ...base,
      fontFamily: "custom" as const,
      customFont: { name: "Brand", url: ok },
    };
    expect(themeForPlan(custom, false, SUPABASE).fontFamily).toBe("inter");
  });

  it("has 1,700+ library families, all with CSS-safe names and at least one weight", () => {
    expect(FONT_LIBRARY.length).toBeGreaterThan(1_700);
    for (const entry of FONT_LIBRARY) {
      const [family] = entry.split("|");
      expect(family).toMatch(/^[A-Za-z0-9 ]{2,60}$/);
      expect(findLibraryFont(family)!.weights.length).toBeGreaterThan(0);
    }
    expect(new Set(FONT_LIBRARY.map((e) => e.split("|")[0])).size).toBe(
      FONT_LIBRARY.length,
    );
    expect(themeFontStack({ fontFamily: "library", libraryFont: "Fraunces" })).toBe(
      '"Fraunces", var(--font-inter), sans-serif',
    );
    // A name that could break out of the CSS string falls back.
    expect(
      themeFontStack({ fontFamily: "library", libraryFont: 'x", red; a: "' }),
    ).not.toContain("red");
  });

  it("drop an uploaded font whose URL isn't allowed, even on a paid plan", () => {
    const custom = { ...base, fontFamily: "custom" as const };
    expect(
      themeForPlan({ ...custom, customFont: { name: "Brand", url: ok } }, true, SUPABASE),
    ).toMatchObject({ fontFamily: "custom" });
    expect(
      themeForPlan(
        { ...custom, customFont: { name: "Brand", url: "https://evil.example/x.woff2" } },
        true,
        SUPABASE,
      ),
    ).toMatchObject({ fontFamily: "inter", customFont: undefined });
    expect(themeForPlan(custom, true, SUPABASE).fontFamily).toBe("inter");
  });

  it("has 50+ readable theme presets, each font in the library", () => {
    expect(THEME_PRESETS.length).toBeGreaterThanOrEqual(50);
    expect(new Set(THEME_PRESETS.map((p) => p.id)).size).toBe(THEME_PRESETS.length);
    for (const { theme } of THEME_PRESETS) {
      if (theme.fontFamily === "library")
        expect(findLibraryFont(theme.libraryFont)).not.toBeNull();
      expect(
        contrastRatio(theme.textColor!, theme.backgroundColor),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("recognise WOFF2 by its signature", () => {
    expect(isWoff2(new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 1]))).toBe(true);
    expect(isWoff2(new Uint8Array([0x00, 0x01, 0x00, 0x00, 0, 1]))).toBe(false);
  });
});
