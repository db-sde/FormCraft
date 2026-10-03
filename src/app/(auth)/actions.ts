"use server";

import { redirect } from "next/navigation";
import {
  SignupInput,
  LoginInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  mapAuthError,
} from "@/domains/identity";
import { hitRateLimit } from "@/domains/abuse";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getClientIpFromHeaders } from "@/lib/http/client-ip";
import { safeNextPath } from "@/lib/http/safe-next-path";
import { needsSecondFactor } from "@/domains/identity/mfa";
import { emailDomain } from "@/domains/identity/sso";

export type ActionResult = {
  error?: string;
  /** "warn" for rate limits (amber banner), otherwise a red error. */
  errorTone?: "error" | "warn";
  fieldErrors?: Record<string, string>;
  /** Non-secret values echoed back so the form can refill them — React
   * resets uncontrolled fields after a form action, which would
   * otherwise wipe the email someone typed on every failed attempt. */
  values?: Record<string, string>;
};

const RATE_LIMITED_MESSAGE = "Too many attempts. Wait a minute, then try again.";
const SIGNUP_RATE_LIMITED_MESSAGE =
  "Too many sign-up attempts from this network. Try again in a few minutes.";

function echo(formData: FormData, keys: string[]): Record<string, string> {
  return Object.fromEntries(
    keys.map((k) => [
      k,
      typeof formData.get(k) === "string" ? String(formData.get(k)) : "",
    ]),
  );
}

/** Where to go after login. Only same-site relative paths are allowed —
 * never "//evil.com" or an absolute URL, or `?next=` becomes an open
 * redirect for phishing. */
function firstFieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export async function signUpAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = SignupInput.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  const values = echo(formData, ["fullName", "email"]);
  if (!parsed.success) {
    return { fieldErrors: firstFieldErrors(parsed.error.issues), values };
  }

  const ip = await getClientIpFromHeaders();
  // Per-IP, not per-email — an attacker enumerating emails shouldn't
  // get a fresh budget for every address they try.
  if (
    !(await hitRateLimit(createAdminClient(), `signup:${ip}`, 10, 60 * 60 * 1000)).allowed
  ) {
    return { error: SIGNUP_RATE_LIMITED_MESSAGE, errorTone: "warn", values };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/confirm?next=${encodeURIComponent(safeNextPath(formData.get("next")))}`,
    },
  });

  if (error) {
    return { error: mapAuthError(error.message).message, values };
  }

  redirect("/signup/check-email");
}

export async function logInAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = LoginInput.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  const values = echo(formData, ["email", "next"]);
  if (!parsed.success) {
    return { fieldErrors: firstFieldErrors(parsed.error.issues), values };
  }

  const ip = await getClientIpFromHeaders();
  // Keyed on IP+email together: bounds credential-stuffing against one
  // account without letting a single shared IP (office NAT, a campus)
  // lock every account behind it out from a few failed guesses on
  // someone else's login.
  const rateLimitKey = `login:${ip}:${parsed.data.email.toLowerCase()}`;
  if (
    !(await hitRateLimit(createAdminClient(), rateLimitKey, 10, 10 * 60 * 1000)).allowed
  ) {
    return { error: RATE_LIMITED_MESSAGE, errorTone: "warn", values };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    const mapped = mapAuthError(error.message);
    return {
      error: mapped.message,
      errorTone: mapped.code === "rate_limited" ? "warn" : "error",
      values,
    };
  }

  // Back to the page that sent them to login (the middleware passes it
  // as ?next=), not always the dashboard — after the second factor, for
  // accounts that have one (P3.13).
  const next = safeNextPath(formData.get("next"));
  if (await needsSecondFactor(supabase)) {
    redirect(`/two-factor?next=${encodeURIComponent(next)}`);
  }
  redirect(next);
}

export async function logOutAction(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordResetAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = ForgotPasswordInput.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { fieldErrors: firstFieldErrors(parsed.error.issues) };
  }

  const ip = await getClientIpFromHeaders();
  if (
    !(await hitRateLimit(createAdminClient(), `forgot-password:${ip}`, 5, 60 * 60 * 1000))
      .allowed
  ) {
    // Same "always redirect to check-email" behavior as success —
    // rate-limit state must not leak account-enumeration signal
    // either (see the no-op-on-purpose comment below).
    redirect("/forgot-password/check-email");
  }

  const supabase = await createServerSupabaseClient();
  // Intentionally ignore the result shape beyond errors: never reveal
  // whether an email is registered (avoid account enumeration).
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/confirm?next=/reset-password`,
  });

  redirect("/forgot-password/check-email");
}

export async function resetPasswordAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = ResetPasswordInput.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { fieldErrors: firstFieldErrors(parsed.error.issues) };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    return { error: mapAuthError(error.message).message };
  }

  redirect("/dashboard");
}

/**
 * "Log in with SSO" (P3.12): the work email's domain picks the identity
 * provider registered with Supabase Auth, which sends the browser there.
 * Coming back lands on /auth/confirm, which signs them in and adds them
 * to their company's workspace.
 */
export async function ssoLogInAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "").trim();
  const values = { email };
  const domain = emailDomain(email);
  if (!domain) return { fieldErrors: { email: "Enter your work email." }, values };

  const ip = await getClientIpFromHeaders();
  if (
    !(await hitRateLimit(createAdminClient(), `sso:${ip}`, 20, 10 * 60 * 1000)).allowed
  ) {
    return { error: RATE_LIMITED_MESSAGE, errorTone: "warn", values };
  }

  const supabase = await createServerSupabaseClient();
  const next = safeNextPath(formData.get("next"));
  const { data, error } = await supabase.auth.signInWithSSO({
    domain,
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/confirm?next=${encodeURIComponent(next)}`,
    },
  });
  if (error || !data?.url) {
    return {
      error: `Single sign-on isn't set up for ${domain}. Log in with your password, or ask your workspace admin.`,
      values,
    };
  }
  redirect(data.url);
}
