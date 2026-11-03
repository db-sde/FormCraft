import { z } from "zod";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hitRateLimit } from "@/domains/abuse";
import { apiError, getClientIp } from "../responses/shared";

/** The respondent's own payment calls: the response id (an unguessable
 * id only they have) and, optionally, a coupon code. Rate limited. */
export const PaymentBody = z.object({
  responseId: z.string().uuid(),
  coupon: z.string().max(60).optional().nullable(),
});

export async function readPaymentRequest<T extends z.ZodTypeAny>(
  request: NextRequest,
  schema: T,
  bucket: string,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return { ok: false, response: apiError("invalid_body", "Invalid request.", 400) };
  const limited = await hitRateLimit(
    createAdminClient(),
    `${bucket}:${getClientIp(request)}`,
    30,
    10 * 60 * 1000,
  );
  if (!limited.allowed)
    return {
      ok: false,
      response: apiError("rate_limited", "Too many tries. Wait a few minutes.", 429),
    };
  return { ok: true, data: parsed.data };
}

/** Where the respondent is (the app or a custom domain). */
export function requestOrigin(request: NextRequest): string {
  const origin = request.headers.get("origin");
  return origin && /^https?:\/\/[^/]+$/.test(origin) ? origin : request.nextUrl.origin;
}
