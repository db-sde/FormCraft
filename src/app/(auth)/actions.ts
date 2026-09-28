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

export type ActionResult = { error?: string; fieldErrors?: Record<string, string> };

const RATE_LIMITED_MESSAGE = "Too many attempts. Please wait a few minutes and try again.";

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
  if (!parsed.success) {
    return { fieldErrors: firstFieldErrors(parsed.error.issues) };
  }

  const ip = await getClientIpFromHeaders();
  // Per-IP, not per-email — an attacker enumerating emails shouldn't
  // get a fresh budget for every address they try.
  if (!checkRateLimit(`signup:${ip}`, 10, 60 * 60 * 1000).allowed) {
    return { error: RATE_LIMITED_MESSAGE };
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
    return { error: mapAuthError(error.message).message };
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
  if (!parsed.success) {
    return { fieldErrors: firstFieldErrors(parsed.error.issues) };
  }

  const ip = await getClientIpFromHeaders();
  // Keyed on IP+email together: bounds credential-stuffing against one
  // account without letting a single shared IP (office NAT, a campus)
  // lock every account behind it out from a few failed guesses on
  // someone else's login.
  const rateLimitKey = `login:${ip}:${parsed.data.email.toLowerCase()}`;
  if (!checkRateLimit(rateLimitKey, 10, 10 * 60 * 1000).allowed) {
    return { error: RATE_LIMITED_MESSAGE };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: mapAuthError(error.message).message };
  }

  redirect("/dashboard");
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
