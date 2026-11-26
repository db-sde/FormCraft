/**
 * Reads Google Fonts' public family metadata (fonts.google.com/metadata/
 * fonts) into the font library's records (developer spec item 3). Used by
 * `scripts/fonts-sync.ts` to regenerate font-data.ts and by the monthly
 * refresh of the `font_families` table. Only open-licensed families with a
 * 400, 600 or 700 weight and a CSS-safe name are kept.
 */

export const FONT_CATEGORIES = [
  "sans",
  "serif",
  "display",
  "handwriting",
  "mono",
] as const;
export type FontCategory = (typeof FONT_CATEGORIES)[number];

/** The scripts the picker filters on, with one-letter codes for the
 * generated file. */
export const FONT_SCRIPTS = {
  latin: "l",
  "latin-ext": "x",
  cyrillic: "c",
  greek: "g",
  vietnamese: "v",
  devanagari: "d",
  arabic: "a",
  hebrew: "h",
  bengali: "b",
  tamil: "m",
  telugu: "e",
  gujarati: "u",
  kannada: "n",
  malayalam: "y",
  gurmukhi: "p",
  thai: "i",
  japanese: "j",
  korean: "k",
  "chinese-simplified": "z",
  "chinese-traditional": "t",
} as const;
export type FontScript = keyof typeof FONT_SCRIPTS;

export const SCRIPT_LABEL: Record<FontScript, string> = {
  latin: "Latin",
  "latin-ext": "Latin Extended",
  cyrillic: "Cyrillic",
  greek: "Greek",
  vietnamese: "Vietnamese",
  devanagari: "Devanagari",
  arabic: "Arabic",
  hebrew: "Hebrew",
  bengali: "Bengali",
  tamil: "Tamil",
  telugu: "Telugu",
  gujarati: "Gujarati",
  kannada: "Kannada",
  malayalam: "Malayalam",
  gurmukhi: "Gurmukhi",
  thai: "Thai",
  japanese: "Japanese",
  korean: "Korean",
  "chinese-simplified": "Chinese (Simplified)",
  "chinese-traditional": "Chinese (Traditional)",
};

export type LibraryFont = {
  family: string;
  category: FontCategory;
  /** Of 400, 600 and 700, the weights it has. */
  weights: number[];
  scripts: FontScript[];
  /** Google's popularity rank: lower is more popular. */
  popularity: number;
};

const CATEGORY_OF: Record<string, FontCategory> = {
  "Sans Serif": "sans",
  Serif: "serif",
  Display: "display",
  Handwriting: "handwriting",
  Monospace: "mono",
};

export const SAFE_FAMILY = /^[A-Za-z0-9 ]{2,60}$/;

type RawFamily = {
  family?: unknown;
  category?: unknown;
  subsets?: unknown;
  fonts?: unknown;
  popularity?: unknown;
  isOpenSource?: unknown;
};

/** The metadata response (it may start with an anti-JSON-hijacking
 * prefix) as library records, most popular first. */
export function parseGoogleFontsMetadata(text: string): LibraryFont[] {
  const json = JSON.parse(text.slice(text.indexOf("{"))) as {
    familyMetadataList?: RawFamily[];
  };
  const out: LibraryFont[] = [];
  for (const f of json.familyMetadataList ?? []) {
    if (typeof f.family !== "string" || !SAFE_FAMILY.test(f.family)) continue;
    if (f.isOpenSource === false) continue;
    const category = CATEGORY_OF[String(f.category)];
    if (!category) continue;
    const styles = Object.keys((f.fonts as Record<string, unknown>) ?? {});
    const weights = [400, 600, 700].filter((w) => styles.includes(String(w)));
    if (weights.length === 0) continue;
    const scripts = ((f.subsets as string[]) ?? []).filter(
      (s): s is FontScript => s in FONT_SCRIPTS,
    );
    out.push({
      family: f.family,
      category,
      weights,
      scripts,
      popularity: typeof f.popularity === "number" ? f.popularity : 99_999,
    });
  }
  return out.sort((a, b) => a.popularity - b.popularity);
}

const CODE_TO_SCRIPT = Object.fromEntries(
  Object.entries(FONT_SCRIPTS).map(([s, c]) => [c, s]),
) as Record<string, FontScript>;
const CAT_CODE: Record<FontCategory, string> = {
  sans: "s",
  serif: "r",
  display: "d",
  handwriting: "h",
  mono: "m",
};
const CODE_TO_CAT = Object.fromEntries(
  Object.entries(CAT_CODE).map(([c, code]) => [code, c]),
) as Record<string, FontCategory>;

/** "Family|category|weights|scripts", the generated file's format. */
export function encodeFont(f: LibraryFont): string {
  return `${f.family}|${CAT_CODE[f.category]}|${f.weights.map((w) => w / 100).join("")}|${f.scripts.map((s) => FONT_SCRIPTS[s]).join("")}`;
}

export function decodeFont(entry: string, rank: number): LibraryFont {
  const [family, cat, w, s = ""] = entry.split("|");
  return {
    family,
    category: CODE_TO_CAT[cat] ?? "sans",
    weights: [...w].map((d) => Number(d) * 100),
    scripts: [...s].map((c) => CODE_TO_SCRIPT[c]).filter(Boolean),
    popularity: rank + 1,
  };
}

/** The script a form's language is written in, for offering only fonts
 * that can show it. */
export function scriptForLanguage(language: string): FontScript {
  const lang = language.toLowerCase().split(/[-_]/)[0];
  const map: Record<string, FontScript> = {
    hi: "devanagari",
    mr: "devanagari",
    ne: "devanagari",
    sa: "devanagari",
    ar: "arabic",
    fa: "arabic",
    ur: "arabic",
    he: "hebrew",
    ru: "cyrillic",
    uk: "cyrillic",
    bg: "cyrillic",
    sr: "cyrillic",
    kk: "cyrillic",
    el: "greek",
    vi: "vietnamese",
    bn: "bengali",
    ta: "tamil",
    te: "telugu",
    gu: "gujarati",
    kn: "kannada",
    ml: "malayalam",
    pa: "gurmukhi",
    th: "thai",
    ja: "japanese",
    ko: "korean",
    zh: "chinese-simplified",
  };
  return map[lang] ?? "latin";
}
