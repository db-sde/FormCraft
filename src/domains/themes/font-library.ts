/**
 * The font library (developer spec item 3: 1,700+ fonts on every plan):
 * open-licensed Google Fonts families. They're served from FormCraft's own
 * domain (/fonts/…), so respondents' browsers never contact Google.
 */
import { FONT_LIBRARY } from "./font-data";
import { decodeFont, type LibraryFont } from "./font-metadata";

export { FONT_LIBRARY };
export type { LibraryFont };

let byName: Map<string, LibraryFont> | null = null;

function libraryIndex(): Map<string, LibraryFont> {
  if (byName) return byName;
  byName = new Map();
  FONT_LIBRARY.forEach((entry, i) => {
    const font = decodeFont(entry, i);
    byName!.set(font.family, font);
  });
  return byName;
}

/** The library as records, most popular first. */
export function libraryFonts(): LibraryFont[] {
  return [...libraryIndex().values()];
}

/** The family, if it's in the library (exact name). */
export function findLibraryFont(family: string | undefined | null): LibraryFont | null {
  if (!family) return null;
  return libraryIndex().get(family) ?? null;
}
