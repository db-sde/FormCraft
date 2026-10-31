import { z } from "zod";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { recordAnalyticsEvent } from "@/domains/analytics";
import { hitRateLimit } from "@/domains/abuse";
import { createAdminClient } from "@/lib/supabase/admin";
import { isLikelyBot } from "@/lib/http/bots";
import { EMBED_MODES } from "@/domains/forms/embed-sdk";
import { getClientIp } from "../../responses/shared";

const EventBody = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,80}$/),
  event: z.enum(["impression", "open"]),
  mode: z.enum(EMBED_MODES),
  trigger: z.string().max(20),
  pageview: z.string().regex(/^[a-z0-9]{6,40}$/),
});

/**
 * Embed analytics (F-24): an impression or an open, sent by the embed
 * SDK as a beacon from another site (a text body, so no preflight). One
 * of each per page load: the SDK sends it once and this refuses a
 * repeat of the same page view. Only live forms count; bots are skipped.
 * Always answers 204, so a third-party page learns nothing.
 */
export async function POST(request: NextRequest) {
  const done = new NextResponse(null, { status: 204 });
  if (isLikelyBot(request.headers.get("user-agent"))) return done;
  let parsed;
  try {
    parsed = EventBody.safeParse(JSON.parse((await request.text()).slice(0, 2000)));
  } catch {
    return done;
  }
  if (!parsed.success) return done;
  const admin = createAdminClient();
  const limited = await hitRateLimit(
    admin,
    `embed:${getClientIp(request)}:${parsed.data.slug}`,
    60,
    10 * 60 * 1000,
  );
  if (!limited.allowed) return done;

  const { data: form } = await admin
    .from("forms")
    .select("id, form_versions!inner(status)")
    .eq("slug", parsed.data.slug)
    .eq("form_versions.status", "published")
    .is("deleted_at", null)
    .maybeSingle();
  if (!form) return done;
  const eventType = parsed.data.event === "open" ? "embed_opened" : "embed_impression";
  const { count } = await admin
    .from("analytics_events")
    .select("id", { count: "exact", head: true })
    .eq("form_id", form.id)
    .eq("event_type", eventType)
    .eq("session_id", parsed.data.pageview);
  if ((count ?? 0) > 0) return done;
  await recordAnalyticsEvent(admin, {
    formId: form.id,
    eventType,
    sessionId: parsed.data.pageview,
    metadata: { mode: parsed.data.mode, trigger: parsed.data.trigger },
  }).catch(() => undefined);
  return done;
}
