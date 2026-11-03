import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { startResponse } from "@/domains/responses";
import { loadCredential, saveCredential } from "@/domains/integrations/credentials";
import { reencryptSecrets } from "@/lib/crypto/reencrypt";
import type { EncryptedPayload } from "@/lib/crypto/encryption";

/**
 * Hardening (2026-11-03) against the real database: old secrets
 * rewritten under the current key and bound to their rows, a request
 * claiming only its own response's jobs, finished work pruned, and the
 * embed allowlist readable before sign-in but validated on write.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin: SupabaseClient<Database> = createClient<Database>(
  url,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const anon = createClient<Database>(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  auth: { persistSession: false },
});
const runId = crypto.randomUUID().slice(0, 8);
let ownerId: string;
let ws1: string;
let ws2: string;
let formId: string;
const slug = `hard-${runId}`;

const schema = {
  schemaVersion: 1,
  meta: { title: "Hardening" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  logic: [],
  questions: [
    { id: "q", type: "short_text", order: 0, label: "Q", required: false, settings: {} },
  ],
} as unknown as Json;

beforeAll(async () => {
  const { data: user } = await admin.auth.admin.createUser({
    email: `hard-${runId}@example.com`,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  ownerId = user!.user!.id;
  const { data: a } = await admin
    .from("workspaces")
    .insert({ name: "A", slug: `hard-a-${runId}`, owner_id: ownerId })
    .select("id")
    .single();
  const { data: b } = await admin
    .from("workspaces")
    .insert({ name: "B", slug: `hard-b-${runId}`, owner_id: ownerId })
    .select("id")
    .single();
  ws1 = a!.id;
  ws2 = b!.id;
  const { data: form } = await admin
    .from("forms")
    .insert({ workspace_id: ws1, title: "Hardening", slug, created_by: ownerId })
    .select("id")
    .single();
  formId = form!.id;
  await admin
    .from("form_versions")
    .insert({ form_id: formId, status: "draft", version_number: 1, schema });
  const { error } = await admin.rpc("publish_form_version", {
    target_form_id: formId,
    compiled_schema: schema,
  });
  if (error) throw error;
}, 60_000);

afterAll(async () => {
  await admin.from("workspaces").delete().in("id", [ws1, ws2]);
  await admin.auth.admin.deleteUser(ownerId);
});

function legacyEncrypt(value: unknown): EncryptedPayload {
  const key = createHash("sha256").update(process.env.APP_SECRET!).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return {
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

describe("stored secrets", () => {
  it("rewrites values from before key ids, bound to their row", async () => {
    await admin.from("integration_credentials").insert({
      workspace_id: ws1,
      provider: "stripe",
      encrypted: legacyEncrypt({ secretKey: "sk_legacy" }) as unknown as Json,
      label: "legacy",
    });
    expect(await loadCredential(admin, ws1, "stripe")).toEqual({
      secretKey: "sk_legacy",
    });

    const dry = await reencryptSecrets(admin, { dryRun: true });
    expect(
      dry.find((r) => r.table === "integration_credentials")!.rewritten,
    ).toBeGreaterThan(0);
    const report = await reencryptSecrets(admin);
    expect(report.find((r) => r.table === "integration_credentials")!.failed).toBe(0);
    const { data } = await admin
      .from("integration_credentials")
      .select("encrypted")
      .eq("workspace_id", ws1)
      .eq("provider", "stripe")
      .single();
    expect(data!.encrypted).toMatchObject({ v: 2 });
    expect(await loadCredential(admin, ws1, "stripe")).toEqual({
      secretKey: "sk_legacy",
    });
    // Nothing left to rewrite for this row on a second run.
    const again = await reencryptSecrets(admin, { dryRun: true });
    expect(again.find((r) => r.table === "integration_credentials")!.failed).toBe(0);
  });

  it("won't decrypt a credential copied into another workspace", async () => {
    await saveCredential(admin, ws1, "razorpay", { keySecret: "s1" }, "a");
    const { data } = await admin
      .from("integration_credentials")
      .select("encrypted")
      .eq("workspace_id", ws1)
      .eq("provider", "razorpay")
      .single();
    await admin.from("integration_credentials").insert({
      workspace_id: ws2,
      provider: "razorpay",
      encrypted: data!.encrypted,
      label: "copied",
    });
    await expect(loadCredential(admin, ws2, "razorpay")).rejects.toThrow();
  });
});

describe("background jobs", () => {
  it("lets a request claim only its own response's jobs", async () => {
    const mine = (await startResponse(admin, formId)).responseId;
    const theirs = (await startResponse(admin, formId)).responseId;
    const past = new Date(Date.now() - 60_000).toISOString();
    await admin.from("connector_jobs").insert([
      {
        workspace_id: ws1,
        provider: "airtable",
        action: "sync_response",
        idempotency_key: `hard:${runId}:mine`,
        response_id: mine,
        next_attempt_at: past,
      },
      {
        workspace_id: ws1,
        provider: "airtable",
        action: "sync_response",
        idempotency_key: `hard:${runId}:theirs`,
        response_id: theirs,
        next_attempt_at: past,
      },
    ]);
    const { data: claimed } = await admin.rpc("claim_scoped_connector_jobs", {
      p_response_id: mine,
      p_booking_id: null,
      p_limit: 25,
      p_lease_seconds: 60,
    });
    expect(claimed?.map((j) => j.idempotency_key)).toEqual([`hard:${runId}:mine`]);
    const { data: other } = await admin
      .from("connector_jobs")
      .select("status")
      .eq("idempotency_key", `hard:${runId}:theirs`)
      .single();
    expect(other?.status).toBe("pending");
  });

  it("prunes finished work after its keep period, and only that", async () => {
    const old = new Date(Date.now() - 100 * 86_400_000).toISOString();
    await admin.from("connector_jobs").insert([
      {
        workspace_id: ws1,
        provider: "notion",
        action: "sync_response",
        idempotency_key: `hard:${runId}:old-done`,
        status: "succeeded",
        updated_at: old,
      },
      {
        workspace_id: ws1,
        provider: "notion",
        action: "sync_response",
        idempotency_key: `hard:${runId}:old-pending`,
        status: "pending",
        updated_at: old,
      },
      {
        workspace_id: ws1,
        provider: "notion",
        action: "sync_response",
        idempotency_key: `hard:${runId}:new-done`,
        status: "succeeded",
        // Same keys on every row: a bulk insert sends null for missing ones.
        updated_at: new Date().toISOString(),
      },
    ]);
    const { data: pruned } = await admin.rpc("prune_operational_data", {});
    expect((pruned as { connectorJobs: number }).connectorJobs).toBeGreaterThanOrEqual(1);
    const { data } = await admin
      .from("connector_jobs")
      .select("idempotency_key")
      .like("idempotency_key", `hard:${runId}:%`);
    const keys = (data ?? []).map((r) => r.idempotency_key).sort();
    expect(keys).not.toContain(`hard:${runId}:old-done`);
    expect(keys).toContain(`hard:${runId}:old-pending`);
    expect(keys).toContain(`hard:${runId}:new-done`);
  });
});

describe("embed allowlist", () => {
  it("is readable before sign-in and only accepts origins", async () => {
    expect((await anon.rpc("form_embed_origins", { p_slug: slug })).data).toBeNull();
    const { error: bad } = await admin
      .from("forms")
      .update({ embed_origins: ["https://acme.com/path"] })
      .eq("id", formId);
    expect(bad).not.toBeNull();
    await admin
      .from("forms")
      .update({ embed_origins: ["https://acme.com", "http://localhost:8080"] })
      .eq("id", formId);
    expect((await anon.rpc("form_embed_origins", { p_slug: slug })).data).toEqual([
      "https://acme.com",
      "http://localhost:8080",
    ]);
  });
});
