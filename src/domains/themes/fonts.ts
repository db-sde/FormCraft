import type { ThemeV1 } from "@/domains/forms/schema/v1";
import { SAFE_FAMILY } from "./font-metadata";

/**
 * Theme fonts (PRD P2.22). The built-in fonts and the font library are on
 * every plan; an uploaded font needs the plan's `custom_fonts`. The server
 * applies `themeForPlan` before a form is shown, so a font the plan
 * doesn't include renders as Inter whatever the saved theme says.
 */

export const FREE_FONTS = ["inter", "system", "georgia", "mono"] as const;

export const FONT_LABEL: Record<ThemeV1["fontFamily"], string> = {
  inter: "Inter",
  system: "System",
  georgia: "Georgia",
  mono: "Mono",
  poppins: "Poppins",
  lora: "Lora",
  playfair: "Playfair Display",
  nunito: "Nunito",
  dm_serif: "DM Serif Display",
  custom: "Your own font",
  library: "Font library",
};

/** Only an uploaded font is paid (Starter and up): the built-in fonts and
 * the font library are on every plan (pricing doc, 26 Nov 2026). */
export function isPaidFont(font: ThemeV1["fontFamily"]): boolean {
  return font === "custom";
}

export const MAX_FONT_BYTES = 2 * 1024 * 1024;

/** Where uploaded fonts live; nothing else is accepted as a font URL, so
 * a theme can't point respondents' browsers at a third-party server. */
export function fontStoragePrefix(supabaseUrl: string | undefined): string | null {
  return supabaseUrl
    ? `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/theme-assets/`
    : null;
}

/** A custom font URL safe to put in CSS: our storage, plain path chars. */
export function isAllowedFontUrl(url: string, supabaseUrl: string | undefined): boolean {
  const prefix = fontStoragePrefix(supabaseUrl);
  if (!prefix || !url.startsWith(prefix)) return false;
  return /^[A-Za-z0-9/_.-]+\.woff2$/.test(url.slice(prefix.length));
}

/** The theme as this workspace's plan allows it to be shown. */
export function themeForPlan(
  theme: ThemeV1,
  customFonts: boolean,
  supabaseUrl: string | undefined,
): ThemeV1 {
  // Library families are named in CSS, so the name must be CSS-safe; the
  // /fonts route serves only real library families (a name it doesn't
  // know just falls back to Inter in the browser).
  if (theme.headingFont && !SAFE_FAMILY.test(theme.headingFont)) {
    theme = { ...theme, headingFont: undefined, headingWeight: undefined };
  }
  if (theme.fontFamily === "library") {
    return theme.libraryFont && SAFE_FAMILY.test(theme.libraryFont)
      ? theme
      : { ...theme, fontFamily: "inter", libraryFont: undefined };
  }
  if (!isPaidFont(theme.fontFamily)) return theme;
  const customOk =
    theme.fontFamily !== "custom" ||
    (!!theme.customFont && isAllowedFontUrl(theme.customFont.url, supabaseUrl));
  if (customFonts && customOk) return theme;
  return { ...theme, fontFamily: "inter", customFont: undefined };
}

/** True for a WOFF2 file (by its signature, not its name). */
export function isWoff2(bytes: Uint8Array): boolean {
  return (
    bytes.length > 4 &&
    bytes[0] === 0x77 &&
    bytes[1] === 0x4f &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x32
  );
}
