/**
 * Maps raw Supabase Auth error messages to stable machine codes + a
 * user-facing message. Supabase doesn't give us structured error codes
 * for every case, so this matches on the (documented, stable-enough)
 * message text. Anything unrecognized falls back to a generic message
 * that never echoes raw provider internals back to the user.
 */
export type AuthErrorCode =
  | "duplicate_email"
  | "invalid_credentials"
  | "email_not_confirmed"
  | "expired_or_invalid_link"
  | "weak_password"
  | "rate_limited"
  | "unknown";

export type AuthError = { code: AuthErrorCode; message: string };

export function mapAuthError(rawMessage: string | undefined | null): AuthError {
  const msg = (rawMessage ?? "").toLowerCase();

  if (msg.includes("already registered") || msg.includes("already exists")) {
    return {
      code: "duplicate_email",
      message: "An account with that email already exists. Log in instead?",
    };
  }
  if (msg.includes("invalid login credentials")) {
    return {
      code: "invalid_credentials",
      message: "That email and password don't match. Try again, or reset your password.",
    };
  }
  if (msg.includes("email not confirmed")) {
    return {
      code: "email_not_confirmed",
      message: "Confirm your email first. Check your inbox for the link we sent.",
    };
  }
  if (
    msg.includes("expired") ||
    msg.includes("invalid") ||
    msg.includes("token has expired") ||
    msg.includes("otp")
  ) {
    return {
      code: "expired_or_invalid_link",
      message: "This link has expired or is invalid. Request a new one.",
    };
  }
  if (msg.includes("password") && (msg.includes("weak") || msg.includes("at least"))) {
    return {
      code: "weak_password",
      message: "Choose a stronger password (min. 8 characters).",
    };
  }
  if (msg.includes("rate limit") || msg.includes("too many")) {
    return {
      code: "rate_limited",
      message: "Too many attempts. Wait a minute, then try again.",
    };
  }

  return { code: "unknown", message: "Something went wrong. Please try again." };
}
