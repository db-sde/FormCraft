/**
 * WCAG 2.1 relative-luminance contrast ratio between two hex colors.
 * Used to warn creators about theme combinations that would be hard to
 * read, rather than blocking them outright (Phase 1: "protect against
 * unreadable combinations where feasible with contrast warnings").
 */
function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return [r, g, b];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

export function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexToRgb(hexA));
  const lumB = relativeLuminance(hexToRgb(hexB));
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA for normal text is 4.5:1, 3:1 for large text/UI components.
 * We use the more lenient 3:1 bar since this checks button/background
 * pairs (large-ish, bold UI elements), not body text. */
export const MIN_READABLE_CONTRAST = 3;

export function isReadableContrast(hexA: string, hexB: string): boolean {
  return contrastRatio(hexA, hexB) >= MIN_READABLE_CONTRAST;
}
