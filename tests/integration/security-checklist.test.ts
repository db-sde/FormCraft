import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { encryptJson } from "@/domains/sheets/crypto";
import { disconnectForm } from "@/domains/sheets";
import { rotateSigningSecret } from "@/domains/webhooks";

/**
 * Security checklist of 26 Oct 2026: secrets aren't readable by members
 * (only the server reads them), disconnecting Sheets revokes the token,
 * and public storage holds only images and fonts.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const runId = crypto.randomUUID().slice(0, 8);
const password = `Pw-${crypto.randomUUID()}`;

async function signedIn(email: string) {
  const client = createClient<Database>(url, anonKey, {
    auth: { persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

let ownerId: string;
let viewerId: string;
let workspaceId: string;
let formId: string;
let endpointId: string;
let owner: SupabaseClient<Database>;
let viewer: SupabaseClient<Database>;

beforeAll(async () => {
  process.env.APP_SECRET ??= "integration-test-secret";
  const make = async (label: string) => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `sec-${label}-${runId}@example.com`,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    return data.user.id;
  };
  ownerId = await make("owner");
  viewerId = await make("viewer");
  owner = await signedIn(`sec-owner-${runId}@example.com`);
  viewer = await signedIn(`sec-viewer-${runId}@example.com`);
  const { data: workspace, error } = await owner.rpc("create_workspace_with_owner", {
    workspace_name: "Security",
    workspace_slug: `sec-${runId}`,
  });
  if (error) throw error;
  workspaceId = workspace.id;
  await admin
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: viewerId, role: "viewer" });
  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: "Sec",
      slug: `sec-${runId}`,
      created_by: ownerId,
    })
    .select("id")
    .single();
  formId = form!.id;
  const { data: endpoint } = await admin
    .from("webhook_endpoints")
    .insert({
      form_id: formId,
      url: "https://example.com/hook",
      signing_secret: "whsec_original",
    })
    .select("id")
    .single();
  endpointId = endpoint!.id;
}, 30_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", workspaceId);
  await admin.auth.admin.deleteUser(ownerId);
  await admin.auth.admin.deleteUser(viewerId);
});

describe("secrets stay on the server", () => {
  it("members see a webhook, but never its signing secret", async () => {
    for (const member of [viewer, owner]) {
      const { data } = await member
        .from("webhook_endpoints")
        .select("id, url")
        .eq("id", endpointId);
      expect(data).toEqual([{ id: endpointId, url: "https://example.com/hook" }]);
      const { data: secret, error } = await member
        .from("webhook_endpoints")
        .select("signing_secret")
        .eq("id", endpointId);
      expect(secret).toBeNull();
      expect(error?.message).toMatch(/permission denied/);
    }
  });

  it("only people who manage integrations can make a new secret", async () => {
    expect(await rotateSigningSecret(viewer, endpointId)).toBeNull();
    const fresh = await rotateSigningSecret(owner, endpointId);
    expect(fresh).toMatch(/^whsec_[0-9a-f]{32}$/);
    const { data } = await admin
      .from("webhook_endpoints")
      .select("signing_secret")
      .eq("id", endpointId)
      .single();
    expect(data!.signing_secret).toBe(fresh);
  });

  it("members can't read Google tokens, even encrypted", async () => {
    await admin.from("sheets_connections").insert({
      workspace_id: workspaceId,
      form_id: formId,
      encrypted_tokens: encryptJson({
        accessToken: "ya29.access",
        refreshToken: "1//refresh",
        expiresAt: Date.now() + 60_000,
      }) as unknown as Json,
    });
    const { data, error } = await viewer
      .from("sheets_connections")
      .select("encrypted_tokens")
      .eq("form_id", formId);
    expect(data).toBeNull();
    expect(error?.message).toMatch(/permission denied/);
    const { data: visible } = await viewer
      .from("sheets_connections")
      .select("form_id")
      .eq("form_id", formId);
    expect(visible).toEqual([{ form_id: formId }]);
  });
});

describe("disconnecting Google Sheets", () => {
  it("revokes the token with Google — only when the caller may disconnect", async () => {
    const revoked: string[] = [];
    const revoke = async (token: string) => {
      revoked.push(token);
      return true;
    };
    // A viewer's attempt deletes nothing and revokes nothing.
    await disconnectForm(viewer, formId, admin, revoke);
    expect(revoked).toEqual([]);
    await disconnectForm(owner, formId, admin, revoke);
    expect(revoked).toEqual(["1//refresh"]);
    const { count } = await admin
      .from("sheets_connections")
      .select("id", { count: "exact", head: true })
      .eq("form_id", formId);
    expect(count).toBe(0);
  });
});

describe("public theme storage", () => {
  it("takes images and fonts, never a web page", async () => {
    const page = await owner.storage
      .from("theme-assets")
      .upload(
        `${workspaceId}/evil.html`,
        new Blob(["<script>alert(1)</script>"], { type: "text/html" }),
      );
    expect(page.error).not.toBeNull();
    const svg = await owner.storage
      .from("theme-assets")
      .upload(
        `${workspaceId}/logo.svg`,
        new Blob(["<svg onload=alert(1)/>"], { type: "image/svg+xml" }),
      );
    expect(svg.error).not.toBeNull();
    const png = await owner.storage
      .from("theme-assets")
      .upload(
        `${workspaceId}/logo-${runId}.png`,
        new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
      );
    expect(png.error).toBeNull();
    await admin.storage.from("theme-assets").remove([`${workspaceId}/logo-${runId}.png`]);
  });
});
