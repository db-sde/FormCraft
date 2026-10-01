import type { ThemeV1 } from "@/domains/forms/schema/v1";
import { THEME_FONT_STACK } from "@/components/theme-styles";

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const mix = (a: string, pct: number, b: string) =>
  `color-mix(in oklab, ${a} ${pct}%, ${b})`;

/** Text colour for a theme: the creator's choice, or worked out from the
 * background (near-black on light, near-white on dark). */
export function stageTextColor(theme: ThemeV1): string {
  return (
    theme.textColor || (luminance(theme.backgroundColor) > 0.4 ? "#1c1c1c" : "#f7f7f5")
  );
}

/** Readable text on the primary colour. */
export function onPrimaryColor(theme: ThemeV1): string {
  return luminance(theme.primaryColor) > 0.45 ? "#141414" : "#ffffff";
}

/**
 * Everything a respondent screen derives from the creator's theme (Part 6
 * "Theme derivation"): selected = primary at 16%, hover = primary at 8%,
 * lines = text at 26%, muted text = text at 66%, button / tile / key radii
 * from the button style. Set as CSS variables on the stage root so every
 * control below reads the same values.
 */
export function stageVars(theme: ThemeV1): React.CSSProperties {
  const text = stageTextColor(theme);
  const light = luminance(theme.backgroundColor) > 0.4;
  const button = theme.buttonStyle;
  return {
    "--st-bg": theme.backgroundColor,
    "--st-text": text,
    "--st-primary": theme.primaryColor,
    "--st-on-primary": onPrimaryColor(theme),
    "--st-line": mix(text, 26, theme.backgroundColor),
    "--st-muted": mix(text, 66, theme.backgroundColor),
    "--st-sel": mix(theme.primaryColor, 16, theme.backgroundColor),
    "--st-hover": mix(theme.primaryColor, 8, theme.backgroundColor),
    "--st-field": mix("#ffffff", light ? 55 : 6, theme.backgroundColor),
    "--st-field-solid": mix("#ffffff", light ? 70 : 8, theme.backgroundColor),
    "--st-br": button === "square" ? "0px" : button === "pill" ? "999px" : "8px",
    "--st-tile-br": button === "square" ? "0px" : button === "pill" ? "16px" : "10px",
    "--st-key-br": button === "square" ? "0px" : button === "pill" ? "999px" : "5px",
    "--st-cell-br": button === "square" ? "0px" : button === "pill" ? "12px" : "8px",
    "--st-label-weight": theme.fontFamily === "georgia" ? "500" : "600",
    backgroundColor: theme.backgroundColor,
    color: text,
    fontFamily: THEME_FONT_STACK[theme.fontFamily],
  } as React.CSSProperties;
}
