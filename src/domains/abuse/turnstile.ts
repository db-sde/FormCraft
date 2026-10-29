/**
 * Cloudflare Turnstile (master spec F-26): a per-form CAPTCHA on final
 * submission, on top of the honeypot, rate limits and bot filtering,
 * which all stay on.
 *
 * It fails closed. A form that requires the check never accepts a
 * submission the server couldn't verify: no token, a token Cloudflare
 * rejects, Cloudflare unreachable, or the secret key missing. The
 * respondent is asked to try again; their answers stay saved.
 */

export const TURNSTILE_SCRIPT_HOST = "https://challenges.cloudflare.com";
const SITEVERIFY_URL = `${TURNSTILE_SCRIPT_HOST}/turnstile/v0/siteverify`;
const TIMEOUT_MS = 5000;

/** The public site key the widget renders with, or null. */
export function turnstileSiteKey(): string | null {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || null;
}

/** Both keys are set, so forms can require the check. */
export function isTurnstileConfigured(): boolean {
  return Boolean(turnstileSiteKey() && process.env.TURNSTILE_SECRET_KEY);
}

export type TurnstileResult =
  | { ok: true }
  | {
      ok: false;
      reason: "missing_token" | "not_configured" | "rejected" | "unavailable";
      /** Cloudflare's error codes, for logs (never shown to respondents). */
      codes?: string[];
    };

export async function verifyTurnstile(
  token: string | null | undefined,
  options: {
    remoteIp?: string;
    secret?: string | null;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<TurnstileResult> {
  const secret =
    options.secret === undefined ? process.env.TURNSTILE_SECRET_KEY : options.secret;
  if (!secret) return { ok: false, reason: "not_configured" };
  if (!token) return { ok: false, reason: "missing_token" };

  const body = new URLSearchParams({ secret, response: token });
  if (options.remoteIp) body.set("remoteip", options.remoteIp);

  try {
    const res = await (options.fetchImpl ?? fetch)(SITEVERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const data = (await res.json()) as {
      success?: boolean;
      "error-codes"?: string[];
    };
    if (data.success === true) return { ok: true };
    const codes = data["error-codes"] ?? [];
    // Cloudflare's own failure, not the respondent's.
    if (codes.includes("internal-error"))
      return { ok: false, reason: "unavailable", codes };
    return { ok: false, reason: "rejected", codes };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
