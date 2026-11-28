import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { hitRateLimit } from "@/domains/abuse";
import { VISITOR_ID_PATTERN } from "@/domains/experiments/visitor";
import { captureServerEvent } from "@/lib/analytics/posthog-server";
import { recordAnalyticsEvent } from "./events";

type Admin = SupabaseClient<Database>;

/** One view per visitor per form in this window (QA FC4-03). */
const VIEW_WINDOW_MS = 30 * 60 * 1000;

/** Who's looking: the visitor cookie, or the address and browser when
 * there's none. */
export function viewerKey(
  visitorCookie: string | undefined,
  ip: string,
  userAgent: string | null,
): string {
  return visitorCookie && VISITOR_ID_PATTERN.test(visitorCookie)
    ? visitorCookie
    : createHash("sha256")
        .update(`${ip}|${userAgent ?? ""}`)
        .digest("base64url");
}

/** The page's view ping: true when it's this visitor's first view of
 * the form in the window (the one that counts). */
export async function claimView(admin: Admin, who: string, formId: string) {
  const first = await hitRateLimit(
    admin,
    `view-visitor:${who}:${formId}`,
    1,
    VIEW_WINDOW_MS,
  );
  return first.allowed;
}

/**
 * Every start was a view: a response is started from a form someone is
 * looking at. A start uses up the view that brought them, and when
 * there's none to use (their view ping was lost, or they're on a second
 * response in the same window) it counts one itself. So Starts can never
 * exceed Views (QA FC15-59), while reloads still count once.
 */
export async function startNeedsView(admin: Admin, who: string, formId: string) {
  const fresh = await claimView(admin, who, formId);
  const used = await hitRateLimit(admin, `view-used:${who}:${formId}`, 1, VIEW_WINDOW_MS);
  // No counted view in the window: this start brings its own.
  if (fresh) return true;
  // A counted view, not used by an earlier start: this start uses it.
  return !used.allowed;
}

/** Records one view (our table, then PostHog). Never throws. */
export async function recordView(admin: Admin, formId: string, embedded: boolean) {
  try {
    await recordAnalyticsEvent(admin, {
      formId,
      eventType: "form_viewed",
      metadata: { embedded },
    });
  } catch {
    // Analytics never affects respondents.
    return;
  }
  await captureServerEvent({
    distinctId: crypto.randomUUID(),
    event: "form_viewed",
    properties: { formId, embedded },
  });
}
