import { z } from "zod";
import type { NextRequest } from "next/server";
import { NextResponse, after } from "next/server";
import { recordAnalyticsEvent } from "@/domains/analytics";
import { captureServerEvent } from "@/lib/analytics/posthog-server";
import { hitRateLimit } from "@/domains/abuse";
import { createAdminClient } from "@/lib/supabase/admin";
import { isLikelyBot } from "@/lib/http/bots";
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
  const limited = await hitRateLimit(
    admin,
    `view:${getClientIp(request)}:${parsed.data.formId}`,
    120,
    10 * 60 * 1000,
  );
  if (!limited.allowed) return apiError("rate_limited", "Too many views.", 429);

  const { formId, embedded = false } = parsed.data;
  after(async () => {
    try {
      const { data: live } = await admin
        .from("form_versions")
        .select("id")
        .eq("form_id", formId)
        .eq("status", "published")
        .maybeSingle();
      if (!live) return;
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
