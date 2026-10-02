import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/**
 * Two-factor authentication (PRD P3.13). Supabase Auth enrols and checks
 * authenticator-app (TOTP) codes; the database refuses workspace data to
 * a session that hasn't passed the second factor (mfa_satisfied, see
 * migration 37). Recovery codes are ours: ten one-time codes, stored
 * hashed, shown once. Using one removes the authenticator so the person
 * can sign in and set it up again — it never grants a permanent bypass.
 */

export const RECOVERY_CODE_COUNT = 10;
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o, 1/l/i

function newCode(): string {
  const bytes = randomBytes(10);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

/** Case, spaces and dashes don't matter when typing a code. */
export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hashCode(code: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}

/** Whether this session still owes its second factor. */
export async function needsSecondFactor(supabase: Client): Promise<boolean> {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.nextLevel === "aal2" && data.currentLevel !== "aal2";
}

/** A verified authenticator on this session's user, read from Supabase. */
export async function verifiedTotpFactor(
  supabase: Client,
): Promise<{ id: string } | null> {
  const { data } = await supabase.auth.mfa.listFactors();
  const factor = data?.totp.find((f) => f.status === "verified");
  return factor ? { id: factor.id } : null;
}

/** Fresh recovery codes (old ones stop working). Returns them in plain
 * text, once — only hashes are stored. */
export async function replaceRecoveryCodes(
  admin: Client,
  userId: string,
): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newCode);
  const { error: deleteError } = await admin
    .from("mfa_recovery_codes")
    .delete()
    .eq("user_id", userId);
  if (deleteError) throw deleteError;
  const { error } = await admin
    .from("mfa_recovery_codes")
    .insert(codes.map((code) => ({ user_id: userId, code_hash: hashCode(code) })));
  if (error) throw error;
  return codes;
}

export async function remainingRecoveryCodes(
  admin: Client,
  userId: string,
): Promise<number> {
  const { count } = await admin
    .from("mfa_recovery_codes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("used_at", null);
  return count ?? 0;
}

/** Removes every authenticator and recovery code (turning 2FA off, or
 * after a recovery code is used). */
export async function removeSecondFactor(admin: Client, userId: string): Promise<void> {
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
  if (error) throw error;
  for (const factor of data?.factors ?? []) {
    const { error: deleteError } = await admin.auth.admin.mfa.deleteFactor({
      id: factor.id,
      userId,
    });
    if (deleteError) throw deleteError;
  }
  await admin.from("mfa_recovery_codes").delete().eq("user_id", userId);
}

/** Spends a recovery code: true when it was valid and unused, in which
 * case the authenticator is removed. A code works once, even when two
 * requests race. */
export async function redeemRecoveryCode(
  admin: Client,
  userId: string,
  code: string,
): Promise<boolean> {
  if (normalizeRecoveryCode(code).length !== 10) return false;
  const { data } = await admin
    .from("mfa_recovery_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("code_hash", hashCode(code))
    .is("used_at", null)
    .select("id");
  if (!data?.length) return false;
  await removeSecondFactor(admin, userId);
  return true;
}
