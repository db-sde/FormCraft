import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { hitRateLimit } from "@/domains/abuse";
import { getPublishedSchema } from "@/domains/forms/queries";
import {
  PlacesError,
  placeAddress,
  placesConfigured,
  suggestAddresses,
} from "@/domains/places";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiError, getClientIp, readJsonBody } from "../responses/shared";

/**
 * Address suggestions for a respondent (F-65), proxied so the Google key
 * stays on the server. Only for a live form whose address question has
 * suggestions switched on; limited per address and per form, so a
 * scripted visitor can't run up the creator's Google bill. Any failure
 * is "unavailable": the respondent types the address instead.
 */
const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("suggest"),
    formId: z.string().uuid(),
    questionId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    sessionToken: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
    text: z.string().trim().min(3).max(200),
    language: z
      .string()
      .regex(/^[a-z]{2}$/)
      .optional(),
  }),
  z.object({
    action: z.literal("details"),
    formId: z.string().uuid(),
    questionId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    sessionToken: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
    placeId: z.string().regex(/^[A-Za-z0-9_-]{10,300}$/),
    language: z
      .string()
      .regex(/^[a-z]{2}$/)
      .optional(),
  }),
]);

export async function POST(request: NextRequest) {
  const body = await readJsonBody(request, 4000);
  const parsed = body === null ? null : Body.safeParse(body);
  if (!parsed?.success) return apiError("invalid_body", "Invalid request.", 400);
  if (!placesConfigured()) {
    return apiError("not_configured", "Address suggestions aren't set up.", 503);
  }
  const input = parsed.data;
  const admin = createAdminClient();
  const [perAddress, perForm] = await Promise.all([
    hitRateLimit(admin, `places:${getClientIp(request)}`, 60, 10 * 60 * 1000),
    hitRateLimit(admin, `places-form:${input.formId}`, 3000, 24 * 60 * 60 * 1000),
  ]);
  if (!perAddress.allowed || !perForm.allowed) {
    return apiError("rate_limited", "Too many address searches. Type it instead.", 429);
  }

  const [schema, { data: form }] = await Promise.all([
    getPublishedSchema(admin, input.formId).catch(() => null),
    admin.from("forms").select("workspace_id").eq("id", input.formId).maybeSingle(),
  ]);
  const question = schema?.questions.find((q) => q.id === input.questionId);
  if (!question || question.type !== "address" || !question.settings.autocomplete) {
    return apiError("not_found", "No address suggestions here.", 404);
  }
  // Counted per workspace and month, for the usage page (cost monitoring).
  // (A query only runs when awaited.) Never holds up the lookup itself.
  if (form) {
    await admin
      .rpc("increment_usage", {
        p_workspace_id: form.workspace_id,
        p_metric: "places_lookups",
        p_amount: 1,
      })
      .then(
        () => undefined,
        () => undefined,
      );
  }
  try {
    if (input.action === "suggest") {
      const suggestions = await suggestAddresses({
        text: input.text,
        sessionToken: input.sessionToken,
        countries: question.settings.autocomplete.countries,
        language: input.language,
      });
      return NextResponse.json({ suggestions });
    }
    const address = await placeAddress({
      placeId: input.placeId,
      sessionToken: input.sessionToken,
      language: input.language,
    });
    // Only the parts this question asks for.
    return NextResponse.json({
      address: Object.fromEntries(
        Object.entries(address).filter(([k]) =>
          (question.settings.fields as string[]).includes(k),
        ),
      ),
    });
  } catch (error) {
    if (error instanceof PlacesError) {
      return apiError(
        "unavailable",
        "Address suggestions are unavailable.",
        error.status,
      );
    }
    return apiError("unavailable", "Address suggestions are unavailable.", 502);
  }
}
