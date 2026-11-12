import { createHash } from "node:crypto";
import { z } from "zod";
import { isUnlocked, unlockCookieName } from "@/domains/forms/access";
import type { NextRequest } from "next/server";
import { NextResponse, after } from "next/server";
import { recordAnalyticsEvent } from "@/domains/analytics";
import { captureServerEvent } from "@/lib/analytics/posthog-server";
import { hitRateLimit } from "@/domains/abuse";
import { createAdminClient } from "@/lib/supabase/admin";
import { isLikelyBot } from "@/lib/http/bots";
import { VISITOR_COOKIE, VISITOR_ID_PATTERN } from "@/domains/experiments/visitor";
import { apiError, getClientIp, readJsonBody } from "../shared";

const ViewBody = z.object({
  formId: z.string().uuid(),
  embedded: z.boolean().optional(),
});

/**
 * A view of a public form, sent by the page itself once it has loaded
 * (a beacon, so it also arrives from embeds and fast exits). Counting
 * views here rather than when the server renders the page means only
 * real page loads count: prefetches, link-preview fetchers and pages
 * served from the browser's cache don't. Every visitor counts, the
 * form's own creators included — they're counted as starts too, so
 * Starts can't exceed Views. Bots are skipped; the form must be live.
 */
export async function POST(request: NextRequest) {
  const body = await readJsonBody(request);
  const parsed = ViewBody.safeParse(body);
  if (!parsed.success) return apiError("invalid_body", "Invalid request.", 400);
  if (isLikelyBot(request.headers.get("user-agent"))) {
    return new NextResponse(null, { status: 204 });
  }

  const admin = createAdminClient();
  const { formId } = parsed.data;
  const ip = getClientIp(request);
  // Bursts from one address are refused (QA FC4-03). A view ping that's
  // refused costs the respondent nothing: the form works either way.
  // Without the visitor cookie a real page load always gets, views share
  // one budget per form, whatever address they come from (a caller can
  // change address on every request).
  const visitorCookie = request.cookies.get(VISITOR_COOKIE)?.value;
  const anonymous = !visitorCookie || !VISITOR_ID_PATTERN.test(visitorCookie);
  for (const [key, limit, windowMs] of [
    [`view-burst:${ip}:${formId}`, 20, 60 * 1000],
    [`view:${ip}:${formId}`, 120, 10 * 60 * 1000],
    ...(anonymous ? ([[`view-anon:${formId}`, 20, 60 * 1000]] as const) : []),
  ] as const) {
    if (!(await hitRateLimit(admin, key, limit, windowMs)).allowed)
      return apiError("rate_limited", "Too many views.", 429);
  }

  // Only a live form has views (QA FC5-03): not a draft, an unknown id,
  // or a password-protected form this browser hasn't unlocked.
  const { data: live } = await admin
    .from("form_versions")
    .select("id")
    .eq("form_id", formId)
    .eq("status", "published")
    .maybeSingle();
  if (!live) return apiError("not_found", "Form not found.", 404);
  if (
    !(await isUnlocked(
      admin,
      formId,
      request.cookies.get(unlockCookieName(formId))?.value,
    ))
  )
    return apiError("locked", "Enter the form's password to continue.", 403);

  // One view per visitor per form every 30 minutes (QA FC4-03): reloads
  // and repeated pings don't inflate the count. Without the visitor
  // cookie, the address and browser stand in for the visitor.
  const visitor = request.cookies.get(VISITOR_COOKIE)?.value;
  const who =
    visitor && VISITOR_ID_PATTERN.test(visitor)
      ? visitor
      : createHash("sha256")
          .update(`${ip}|${request.headers.get("user-agent") ?? ""}`)
          .digest("base64url");
  const firstView = await hitRateLimit(
    admin,
    `view-visitor:${who}:${formId}`,
    1,
    30 * 60 * 1000,
  );
  if (!firstView.allowed) return new NextResponse(null, { status: 204 });

  const { embedded = false } = parsed.data;
  after(async () => {
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
  });
  return new NextResponse(null, { status: 204 });
}
