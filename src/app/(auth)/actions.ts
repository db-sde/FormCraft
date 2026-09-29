"use server";

import { redirect } from "next/navigation";
import {
  SignupInput,
  LoginInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  mapAuthError,
} from "@/domains/identity";
import { checkRateLimit } from "@/domains/abuse";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getClientIpFromHeaders } from "@/lib/http/client-ip";

export type ActionResult = {
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Non-secret values echoed back so the form can refill them — React
   * resets uncontrolled fields after a form action, which would
   * otherwise wipe the email someone typed on every failed attempt. */
  values?: Record<string, string>;
};

const RATE_LIMITED_MESSAGE =
  "Too many attempts. Please wait a few minutes and try again.";

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
function safeNextPath(raw: FormDataEntryValue | null): string {
  if (typeof raw !== "string") return "/dashboard";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return "/dashboard";
  }
  return raw;
}

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
  if (!checkRateLimit(`signup:${ip}`, 10, 60 * 60 * 1000).allowed) {
    return { error: RATE_LIMITED_MESSAGE, values };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/login`,
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
  if (!checkRateLimit(rateLimitKey, 10, 10 * 60 * 1000).allowed) {
    return { error: RATE_LIMITED_MESSAGE, values };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: mapAuthError(error.message).message, values };
  }

  // Back to the page that sent them to login (the middleware passes it
  // as ?next=), not always the dashboard.
  redirect(safeNextPath(formData.get("next")));
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
  if (!checkRateLimit(`forgot-password:${ip}`, 5, 60 * 60 * 1000).allowed) {
    // Same "always redirect to check-email" behavior as success —
    // rate-limit state must not leak account-enumeration signal
    // either (see the no-op-on-purpose comment below).
    redirect("/forgot-password/check-email");
  }

  const supabase = await createServerSupabaseClient();
  // Intentionally ignore the result shape beyond errors: never reveal
  // whether an email is registered (avoid account enumeration).
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/reset-password`,
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
