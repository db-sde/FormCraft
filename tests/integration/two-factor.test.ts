import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  redeemRecoveryCode,
  remainingRecoveryCodes,
  replaceRecoveryCodes,
} from "@/domains/identity/mfa";
import { totp } from "../totp";

/** Two-factor authentication (P3.13) against the real auth server and
 * database: with an authenticator enrolled, a password-only session can
 * finish signing in but gets no workspace data — even straight through
 * the API — and a recovery code works once. */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const runId = crypto.randomUUID().slice(0, 8);
const email = `mfa-${runId}@example.com`;
const password = `Pw-${crypto.randomUUID()}`;
let userId: string;
let workspaceId: string;
let secret: string;

async function passwordSession(): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(url, anon, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

beforeAll(async () => {
  const { data } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  userId = data.user!.id;
  const client = await passwordSession();
  const { data: ws } = await client.rpc("create_workspace_with_owner", {
    workspace_name: "MFA",
    workspace_slug: `mfa-${runId}`,
  });
  workspaceId = ws!.id;
  const { data: factor, error } = await client.auth.mfa.enroll({ factorType: "totp" });
  if (error) throw error;
  secret = factor.totp.secret;
  const { error: verifyError } = await client.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code: totp(secret),
  });
  if (verifyError) throw verifyError;
});

afterAll(async () => {
  if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("two-factor authentication", () => {
  it("keeps workspace data from a password-only session until the code is in", async () => {
    const client = await passwordSession();
    const { data: aal } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    expect(aal).toMatchObject({ currentLevel: "aal1", nextLevel: "aal2" });

    expect((await client.from("workspaces").select("id")).data).toEqual([]);
    expect(
      (await client.rpc("is_workspace_member", { target_workspace_id: workspaceId }))
        .data,
    ).toBe(false);
    const write = await client.from("forms").insert({
      workspace_id: workspaceId,
      title: "Nope",
      slug: `mfa-nope-${runId}`,
      created_by: userId,
    });
    expect(write.error).not.toBeNull();

    const { data: factors } = await client.auth.mfa.listFactors();
    const { error } = await client.auth.mfa.challengeAndVerify({
      factorId: factors!.totp[0].id,
      code: totp(secret),
    });
    expect(error).toBeNull();
    expect((await client.from("workspaces").select("id")).data).toEqual([
      { id: workspaceId },
    ]);
  });

  it("accepts a recovery code once, which removes the authenticator", async () => {
    const codes = await replaceRecoveryCodes(admin, userId);
    expect(codes).toHaveLength(10);
    const { data: stored } = await admin
      .from("mfa_recovery_codes")
      .select("code_hash")
      .eq("user_id", userId);
    expect(JSON.stringify(stored)).not.toContain(codes[0].replace("-", ""));

    expect(await redeemRecoveryCode(admin, userId, "aaaaa-bbbbb")).toBe(false);
    expect(await redeemRecoveryCode(admin, userId, ` ${codes[3].toUpperCase()} `)).toBe(
      true,
    );
    // Factors and the other codes are gone; the same code can't come back.
    expect(await remainingRecoveryCodes(admin, userId)).toBe(0);
    expect(await redeemRecoveryCode(admin, userId, codes[3])).toBe(false);
    const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId });
    expect(factors?.factors).toEqual([]);

    const client = await passwordSession();
    expect((await client.from("workspaces").select("id")).data).toEqual([
      { id: workspaceId },
    ]);
  });
});
