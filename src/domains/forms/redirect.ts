import type { EndingV1, FormSchemaV1 } from "./schema/v1";

export const DEFAULT_REDIRECT_DELAY = 3;

/**
 * Where an ending sends people, and after how long (P2.9): the ending's
 * own redirect wins; otherwise the form's default. Null = no redirect.
 * URLs were validated as web URLs by the schema; recall is filled in by
 * the runtime (renderRecallUrl keeps the creator's host).
 */
export function endingRedirect(
  schema: Pick<FormSchemaV1, "meta">,
  ending: EndingV1,
): { url: string; delaySeconds: number; fromDefault: boolean } | null {
  if (ending.redirectUrl) {
    return {
      url: ending.redirectUrl,
      delaySeconds: ending.redirectDelaySeconds ?? DEFAULT_REDIRECT_DELAY,
      fromDefault: false,
    };
  }
  const fallback = schema.meta.defaultRedirect;
  return fallback
    ? { url: fallback.url, delaySeconds: fallback.delaySeconds, fromDefault: true }
    : null;
}
