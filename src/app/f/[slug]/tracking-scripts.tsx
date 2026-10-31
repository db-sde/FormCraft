import { pixelSnippets, trackFunction, type TrackingIds } from "./pixels";
import { PixelLoader } from "./pixel-loader";

export { safeTrackingIds, type TrackingIds } from "./pixels";

/**
 * Analytics and ad pixels on the live form (P2.12, F-44). The snippets
 * are built here on the server from checked ids; the browser loads them
 * (with the page's nonce) only when allowed: never when the browser sends
 * Global Privacy Control, and — when the creator asks for consent — only
 * after the respondent says yes.
 */
export function TrackingScripts({
  ids,
  nonce,
  formId,
  consent = "none",
}: {
  ids: TrackingIds;
  nonce?: string;
  formId: string;
  consent?: "none" | "ask";
}) {
  const snippets = pixelSnippets(ids);
  if (snippets.length === 0) return null;
  return (
    <PixelLoader
      formId={formId}
      nonce={nonce}
      consent={consent}
      snippets={snippets}
      track={trackFunction(ids)}
    />
  );
}
