"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeNextPath } from "@/lib/http/safe-next-path";
import { hitRateLimit } from "@/domains/abuse";
import { auditUser } from "@/domains/audit";
import {
  redeemRecoveryCode,
  removeSecondFactor,
  replaceRecoveryCodes,
  verifiedTotpFactor,
} from "@/domains/identity/mfa";

export type TwoFactorResult = { error?: string };

const TOO_MANY = "Too many attempts. Wait a few minutes and try again.";

/** Signed in with a password (aal1) but owing the second factor. */
async function signedIn() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

async function allowAttempt(userId: string): Promise<boolean> {
  const limit = await hitRateLimit(
    createAdminClient(),
    `mfa:${userId}`,
    10,
    10 * 60 * 1000,
  );
  return limit.allowed;
}

/** Sign-in step two: the code from the authenticator app. */
export async function verifyTwoFactorAction(
  _prev: TwoFactorResult,
  formData: FormData,
): Promise<TwoFactorResult> {
  const code = String(formData.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { error: "Enter the 6-digit code from your app." };
  const { supabase, user } = await signedIn();
  if (!(await allowAttempt(user.id))) return { error: TOO_MANY };
  const factor = await verifiedTotpFactor(supabase);
  if (!factor) redirect(safeNextPath(formData.get("next")));
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code,
  });
  if (error) return { error: "That code didn't work. Codes change every 30 seconds." };
  redirect(safeNextPath(formData.get("next")));
}

/** Sign-in with a recovery code: removes the authenticator so it can be
 * set up again. */
export async function redeemRecoveryCodeAction(
  _prev: TwoFactorResult,
  formData: FormData,
): Promise<TwoFactorResult> {
  const code = String(formData.get("recoveryCode") ?? "");
  const { supabase, user } = await signedIn();
  if (!(await allowAttempt(user.id))) return { error: TOO_MANY };
  const admin = createAdminClient();
  if (!(await redeemRecoveryCode(admin, user.id, code)))
    return { error: "That recovery code isn't valid or was already used." };
  await auditUser(admin, user.id, "security.recovery_code_used");
  // Pick up that the account no longer has a second factor.
  await supabase.auth.refreshSession();
  redirect("/settings?tab=account&notice=two_factor_reset");
}

const Code = z.string().regex(/^\d{6}$/);

/** Settings: finish setting up an authenticator. The browser enrolled a
 * factor; the code proves the app has it. Returns recovery codes, once. */
export async function confirmTwoFactorAction(
  factorId: string,
  code: string,
): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; message: string }> {
  if (!Code.safeParse(code).success || !z.string().uuid().safeParse(factorId).success)
    return { ok: false, message: "Enter the 6-digit code from your app." };
  const { supabase, user } = await signedIn();
  if (!(await allowAttempt(user.id))) return { ok: false, message: TOO_MANY };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error)
    return {
      ok: false,
      message: "That code didn't work. Codes change every 30 seconds.",
    };
  const admin = createAdminClient();
  const recoveryCodes = await replaceRecoveryCodes(admin, user.id);
  await auditUser(admin, user.id, "security.mfa_enabled");
  return { ok: true, recoveryCodes };
}

/** Settings: new recovery codes. Needs a session that passed 2FA. */
export async function regenerateRecoveryCodesAction(): Promise<
  { ok: true; recoveryCodes: string[] } | { ok: false; message: string }
> {
  const { supabase, user } = await signedIn();
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (data?.currentLevel !== "aal2" || !(await verifiedTotpFactor(supabase)))
    return { ok: false, message: "Two-factor authentication isn't on." };
  return {
    ok: true,
    recoveryCodes: await replaceRecoveryCodes(createAdminClient(), user.id),
  };
}

/** Settings: turn 2FA off. Needs a session that passed 2FA and a current
 * code, so a borrowed signed-in browser isn't enough. */
export async function disableTwoFactorAction(
  code: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!Code.safeParse(code).success)
    return { ok: false, message: "Enter the 6-digit code from your app." };
  const { supabase, user } = await signedIn();
  if (!(await allowAttempt(user.id))) return { ok: false, message: TOO_MANY };
  const factor = await verifiedTotpFactor(supabase);
  if (!factor) return { ok: false, message: "Two-factor authentication isn't on." };
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code,
  });
  if (error)
    return {
      ok: false,
      message: "That code didn't work. Codes change every 30 seconds.",
    };
  const admin = createAdminClient();
  await removeSecondFactor(admin, user.id);
  await auditUser(admin, user.id, "security.mfa_disabled");
  await supabase.auth.refreshSession();
  return { ok: true };
}
