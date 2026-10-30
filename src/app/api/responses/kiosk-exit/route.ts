import { z } from "zod";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { hitRateLimit } from "@/domains/abuse";
import { checkKioskPin, KIOSK_PIN_PATTERN } from "@/domains/forms/kiosk";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiError, getClientIp, readJsonBody } from "../shared";

const ExitBody = z.object({
  formId: z.string().uuid(),
  pin: z.string().regex(KIOSK_PIN_PATTERN).or(z.literal("")),
});

/**
 * Checks a kiosk's exit PIN (master spec F-15). Leaving kiosk mode itself
 * happens in the browser; this only says whether the PIN is right, and is
 * rate-limited so it can't be guessed by trying them all.
 */
export async function POST(request: NextRequest) {
  const body = await readJsonBody(request);
  if (body === null)
    return apiError("invalid_body", "Request body is missing or too large.", 400);
  const parsed = ExitBody.safeParse(body);
  if (!parsed.success) return apiError("wrong_pin", "That PIN isn't right.", 401);

  const admin = createAdminClient();
  const rateLimit = await hitRateLimit(
    admin,
    `kiosk-exit:${getClientIp(request)}:${parsed.data.formId}`,
    10,
    10 * 60 * 1000,
  );
  if (!rateLimit.allowed) {
    return apiError("rate_limited", "Too many attempts. Please try again later.", 429);
  }
  try {
    const ok = await checkKioskPin(admin, parsed.data.formId, parsed.data.pin);
    return ok
      ? NextResponse.json({ ok: true })
      : apiError("wrong_pin", "That PIN isn't right.", 401);
  } catch {
    return apiError("unknown", "Something went wrong. Please try again.", 500);
  }
}
