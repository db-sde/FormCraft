import { z } from "zod";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hitRateLimit } from "@/domains/abuse";
import { parseFormSchema } from "@/domains/forms/schema";
import { loadBookingType, slotsBetween } from "@/domains/bookings/server";
import { apiError, getClientIp } from "../../responses/shared";

const Query = z.object({
  response: z.string().uuid(),
  question: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.coerce.number().int().min(1).max(14).default(7),
});

function addDays(date: string, days: number) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Free times for a booking question (F-27), for a response that's being
 * filled in: only the booking type that question names on the version
 * the response answers, and only start times — never who the hosts are
 * or what else is in their calendars.
 */
export async function GET(request: NextRequest) {
  const parsed = Query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return apiError("invalid_query", "Invalid request.", 400);
  const admin = createAdminClient();
  const limited = await hitRateLimit(
    admin,
    `slots:${getClientIp(request)}`,
    120,
    10 * 60 * 1000,
  );
  if (!limited.allowed) return apiError("rate_limited", "Too many requests.", 429);

  // The version this respondent is answering, while they're answering it.
  const { data: response } = await admin
    .from("responses")
    .select("status, form_versions!inner(schema), forms!inner(workspace_id, deleted_at)")
    .eq("id", parsed.data.response)
    .is("forms.deleted_at", null)
    .maybeSingle();
  if (!response || response.status === "completed") {
    return apiError("not_found", "Form not found.", 404);
  }
  const question = parseFormSchema(
    (response.form_versions as { schema: unknown }).schema,
  ).questions.find((q) => q.id === parsed.data.question && q.type === "booking");
  const typeId =
    question?.type === "booking" ? question.settings.bookingTypeId : undefined;
  const type = typeId ? await loadBookingType(admin, typeId) : null;
  if (
    !type ||
    type.workspaceId !== (response.forms as { workspace_id: string }).workspace_id
  ) {
    return apiError("not_found", "Bookings aren't available.", 404);
  }
  const to = addDays(parsed.data.from, parsed.data.days - 1);
  const slots = await slotsBetween(admin, type, parsed.data.from, to);
  return NextResponse.json(
    {
      timeZone: type.rules.timeZone,
      durationMinutes: type.rules.durationMinutes,
      slots: slots.map((s) => s.start),
      maxDaysAhead: type.rules.maxDaysAhead,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
