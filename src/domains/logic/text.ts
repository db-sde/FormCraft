/** Invisible formatting characters: zero-width space, ZWNJ, ZWJ, BOM,
 * direction marks and the like (Unicode category Cf). */
const INVISIBLE = /\p{Cf}/gu;

/**
 * Text as a person sees it: invisible characters removed, surrounding
 * spaces (any kind, including non-breaking) trimmed. An answer of only
 * zero-width spaces is empty, so it can't satisfy a required question or
 * a minimum length (QA FC5-02).
 */
export function visibleText(text: string): string {
  return text.replace(INVISIBLE, "").trim();
}
