import {
  THEME_VARIANT_ID,
  type FormSchemaV1,
  type ThemeV1,
  type ThemeVariantV1,
} from "@/domains/forms/schema/v1";
import { applyPreset, findPreset } from "./presets";

/**
 * Link themes (F-66): a form's link can pick one of the looks its creator
 * saved or a built-in preset, with `?theme=<id>` (or `data-theme` on an
 * embed). Anything else —
 * an unknown id, a malformed value, a list of them — gets the form's own
 * theme. The URL only ever names a saved look: no colours, fonts or CSS
 * come from it, and the form's custom CSS applies whichever look is used.
 */
export function themeForLink(schema: FormSchemaV1, requested: unknown): ThemeV1 {
  if (typeof requested !== "string" || !THEME_VARIANT_ID.test(requested)) {
    return schema.theme;
  }
  const variant = schema.themeVariants?.find((v) => v.id === requested);
  if (variant) return { ...variant.theme, customCss: schema.theme.customCss };
  // The built-in presets' ids are allowed too (developer spec item 3):
  // known values only, never anything from the URL itself.
  const preset = findPreset(requested);
  return preset ? applyPreset(schema.theme, preset) : schema.theme;
}

/** The id a new link theme gets from its name: "Dark mode" → "dark-mode",
 * numbered when taken. */
export function themeVariantId(name: string, taken: ThemeVariantV1[]): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "theme";
  const used = new Set(taken.map((v) => v.id));
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}

/** The form's current look, saved as a link theme. */
export function saveLookAsVariant(
  theme: ThemeV1,
  name: string,
  taken: ThemeVariantV1[],
): ThemeVariantV1 {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { customCss, ...look } = theme;
  return { id: themeVariantId(name, taken), name: name.trim().slice(0, 60), theme: look };
}
