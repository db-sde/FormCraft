import { describe, expect, it } from "vitest";
import { isAllowedFontUrl, isWoff2, themeForPlan } from "@/domains/themes/fonts";

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

  it("show Inter for paid fonts the plan doesn't include", () => {
    expect(
      themeForPlan({ ...base, fontFamily: "lora" }, false, SUPABASE).fontFamily,
    ).toBe("inter");
    expect(themeForPlan({ ...base, fontFamily: "lora" }, true, SUPABASE).fontFamily).toBe(
      "lora",
    );
    expect(
      themeForPlan({ ...base, fontFamily: "georgia" }, false, SUPABASE).fontFamily,
    ).toBe("georgia");
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

  it("recognise WOFF2 by its signature", () => {
    expect(isWoff2(new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 1]))).toBe(true);
    expect(isWoff2(new Uint8Array([0x00, 0x01, 0x00, 0x00, 0, 1]))).toBe(false);
  });
});
