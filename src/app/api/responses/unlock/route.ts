import { z } from "zod";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { hitRateLimit } from "@/domains/abuse";
import {
  createUnlockToken,
  getPasswordHash,
  PASSWORD_MAX_LENGTH,
  UNLOCK_TTL_SECONDS,
  unlockCookieName,
  verifyPassword,
} from "@/domains/forms/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiError, getClientIp, readJsonBody } from "../shared";

const UnlockBody = z.object({
  formId: z.string().uuid(),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

/**
 * Opens a password-protected form (master spec F-48): checks the
 * password and sets this form's unlock cookie. The page then renders
 * the form; start and submit check the same cookie. Rate-limited per
 * address and form, so a shared password can't be guessed quickly.
 */
export async function POST(request: NextRequest) {
  const body = await readJsonBody(request);
  if (body === null)
    return apiError("invalid_body", "Request body is missing or too large.", 400);
  const parsed = UnlockBody.safeParse(body);
  if (!parsed.success) return apiError("invalid_body", "Invalid request.", 400);

  const admin = createAdminClient();
  const rateLimit = await hitRateLimit(
    admin,
    `unlock:${getClientIp(request)}:${parsed.data.formId}`,
    10,
    10 * 60 * 1000,
  );
  if (!rateLimit.allowed) {
    return apiError("rate_limited", "Too many attempts. Please try again later.", 429);
  }

  try {
    const hash = await getPasswordHash(admin, parsed.data.formId);
    // No password (removed meanwhile, or never set): nothing to unlock,
    // and the answer doesn't say which forms have one.
    if (hash === null) return NextResponse.json({ ok: true });
    if (!(await verifyPassword(parsed.data.password, hash))) {
      return apiError("wrong_password", "That password isn't right.", 401);
    }

    const response = NextResponse.json({ ok: true });
    const secure = request.nextUrl.protocol === "https:";
    response.cookies.set(
      unlockCookieName(parsed.data.formId),
      createUnlockToken(parsed.data.formId, hash),
      {
        httpOnly: true,
        path: "/",
        maxAge: UNLOCK_TTL_SECONDS,
        // Embeds load the form in a third-party iframe; partitioned
        // keeps the cookie to that one embedding site.
        sameSite: secure ? "none" : "lax",
        secure,
        partitioned: secure,
      },
    );
    return response;
  } catch {
    return apiError("unknown", "Something went wrong. Please try again.", 500);
  }
}
