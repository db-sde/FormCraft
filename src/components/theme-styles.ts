import type { ThemeV1 } from "@/domains/forms/schema/v1";

export const THEME_FONT_STACK: Record<ThemeV1["fontFamily"], string> = {
  inter: "var(--font-inter), sans-serif",
  system: "system-ui, sans-serif",
  georgia: "Georgia, serif",
  mono: "var(--font-jetbrains-mono), monospace",
  poppins: "var(--font-poppins), sans-serif",
  lora: "var(--font-lora), serif",
  playfair: "var(--font-playfair), serif",
  nunito: "var(--font-nunito), sans-serif",
  dm_serif: "var(--font-dm-serif), serif",
  // Stage declares the uploaded face as "fc-custom" (stage.tsx).
  custom: '"fc-custom", var(--font-inter), sans-serif',
};

export const THEME_BUTTON_RADIUS: Record<ThemeV1["buttonStyle"], string> = {
  rounded: "8px",
  square: "2px",
  pill: "999px",
};

/**
 * CSS variables that re-point the shared UI primitives (checkboxes,
 * radios, focus rings) at a *form's* theme instead of FormCraft's own
 * brand tokens. Put on the respondent form's root so the creator's
 * colours win everywhere inside it.
 */
export function themeTokenOverrides(theme: ThemeV1): Record<string, string> {
  return {
    "--primary": theme.primaryColor,
    "--primary-foreground": "#ffffff",
    "--ring": theme.primaryColor,
  };
}

/** The form's own look — background, text, font, image — for any
 * surface that should appear exactly as respondents see it. */
export function themeSurfaceStyle(theme: ThemeV1): Record<string, string | undefined> {
  return {
    ...themeTokenOverrides(theme),
    backgroundColor: theme.backgroundColor,
    color: theme.textColor ?? undefined,
    fontFamily: THEME_FONT_STACK[theme.fontFamily],
    backgroundImage: theme.backgroundImageUrl
      ? `url(${theme.backgroundImageUrl})`
      : undefined,
    backgroundSize: "cover",
    backgroundPosition: "center",
  };
}

export function themeButtonStyle(theme: ThemeV1): Record<string, string> {
  return {
    backgroundColor: theme.primaryColor,
    borderRadius: THEME_BUTTON_RADIUS[theme.buttonStyle],
    color: "#ffffff",
  };
}
