import type { ThemeV1 } from "@/domains/forms/schema/v1";

export const THEME_FONT_STACK: Record<ThemeV1["fontFamily"], string> = {
  inter: "var(--font-geist-sans), sans-serif",
  system: "system-ui, sans-serif",
  georgia: "Georgia, serif",
  mono: "var(--font-geist-mono), monospace",
};

export const THEME_BUTTON_RADIUS: Record<ThemeV1["buttonStyle"], string> = {
  rounded: "8px",
  square: "2px",
  pill: "999px",
};
