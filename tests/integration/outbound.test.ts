import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { completeResponse, startResponse } from "@/domains/responses";
import { authenticateApiKey, createApiKey, ApiKeyError } from "@/domains/api";
import { createWebhookEndpoint } from "@/domains/webhooks";

vi.mock("server-only", () => ({}));
const { saveConfirmationSettings, sendConfirmationEmail, DEFAULT_CONFIRMATION } =
  await import("@/domains/notifications/confirmation");

/** Wave 4 against the real database: confirmation emails (plan, once
 * per response, never for spam), API keys (plan, hashing, revoking
 * removes their subscriptions) and the Slack URL rule. */
const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const runId = crypto.randomUUID().slice(0, 8);
const schema = {
  schemaVersion: 1,
  meta: { title: "Outbound" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    {
      id: "name",
      type: "short_text",
      order: 0,
      label: "Name",
      required: true,
      settings: {},
    },
    {
      id: "email",
      type: "email",
      order: 1,
      label: "Email",
      required: true,
      settings: {},
    },
  ],
  logic: [],
} as unknown as Json;

let userId: string;
let workspaceId: string;
let formId: string;

async function completed(email: string, trap = false) {
  const { responseId } = await startResponse(admin, formId);
  await completeResponse(
    admin,
    responseId,
    1,
    "email",
    { name: "Ada", email },
    crypto.randomUUID(),
    { spamSuspected: trap },
  );
  return responseId;
}

beforeAll(async () => {
  const { data: user } = await admin.auth.admin.createUser({
    email: `outbound-${runId}@example.com`,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  userId = user!.user!.id;
  const { data: ws } = await admin
    .from("workspaces")
    .insert({ name: "Outbound", slug: `outbound-${runId}`, owner_id: userId })
    .select("id")
    .single();
  workspaceId = ws!.id;
  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: "Outbound",
      slug: `outbound-${runId}`,
      created_by: userId,
    })
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
  await saveConfirmationSettings(admin, formId, {
    ...DEFAULT_CONFIRMATION,
    enabled: true,
    recipientQuestionId: "email",
    subject: "Thanks {{answer:name}}",
  });
});

afterAll(async () => {
  if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("confirmation emails", () => {
  it("need the plan, go once per response, and skip spam", async () => {
    const sent: { to: string; subject: string }[] = [];
    const send = async (m: { to: string; subject: string }) => {
      sent.push(m);
      return true;
    };

    const first = await completed("ada@example.com");
    expect(await sendConfirmationEmail(admin, first, { send })).toEqual({
      sent: false,
      reason: "not_on_plan",
    });

    await admin.from("workspaces").update({ plan_id: "business" }).eq("id", workspaceId);
    expect(await sendConfirmationEmail(admin, first, { send })).toEqual({ sent: true });
    expect(await sendConfirmationEmail(admin, first, { send })).toEqual({
      sent: false,
      reason: "already_handled",
    });
    expect(sent).toEqual([
      expect.objectContaining({ to: "ada@example.com", subject: "Thanks Ada" }),
    ]);

    const spam = await completed("bot@example.com", true);
    expect(await sendConfirmationEmail(admin, spam, { send })).toEqual({
      sent: false,
      reason: "spam",
    });
    expect(sent).toHaveLength(1);
  });
});

describe("API keys", () => {
  it("need the plan, are stored hashed, and authenticate their workspace", async () => {
    await admin.from("workspaces").update({ plan_id: "pro" }).eq("id", workspaceId);
    await expect(
      createApiKey(admin, { workspaceId, name: "Zapier", createdBy: userId }),
    ).rejects.toBeInstanceOf(ApiKeyError);

    await admin.from("workspaces").update({ plan_id: "business" }).eq("id", workspaceId);
    const { id, key } = await createApiKey(admin, {
      workspaceId,
      name: "Zapier",
      createdBy: userId,
    });
    expect(key).toMatch(/^fc_live_[A-Za-z0-9_-]{43}$/);
    const { data: row } = await admin
      .from("api_keys")
      .select("key_hash, prefix")
      .eq("id", id)
      .single();
    expect(row?.key_hash).not.toContain(key.slice(8));
    expect(key.startsWith(row!.prefix)).toBe(true);

    expect(await authenticateApiKey(admin, `Bearer ${key}`)).toEqual({
      keyId: id,
      workspaceId,
      scopes: ["forms:read", "responses:read", "hooks:write"],
    });
    expect(await authenticateApiKey(admin, `Bearer ${key.slice(0, -1)}x`)).toBeNull();
    expect(await authenticateApiKey(admin, key)).toBeNull();

    // A downgrade cuts access straight away.
    await admin.from("workspaces").update({ plan_id: "pro" }).eq("id", workspaceId);
    expect(await authenticateApiKey(admin, `Bearer ${key}`)).toBeNull();
    await admin.from("workspaces").update({ plan_id: "business" }).eq("id", workspaceId);
  });

  it("take their subscriptions with them when revoked", async () => {
    const { id, key } = await createApiKey(admin, {
      workspaceId,
      name: "Make",
      createdBy: userId,
    });
    const hook = await createWebhookEndpoint(
      admin,
      formId,
      "https://hook.example.com/x",
      {
        kind: "make",
        apiKeyId: id,
      },
    );
    await admin
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id);
    const { data } = await admin.from("webhook_endpoints").select("id").eq("id", hook.id);
    expect(data).toEqual([]);
    expect(await authenticateApiKey(admin, `Bearer ${key}`)).toBeNull();
  });
});

describe("Slack endpoints", () => {
  it("only point at Slack", async () => {
    await expect(
      createWebhookEndpoint(admin, formId, "https://evil.example/hook", {
        kind: "slack",
      }),
    ).rejects.toBeTruthy();
    const ok = await createWebhookEndpoint(
      admin,
      formId,
      "https://hooks.slack.com/services/T0/B0/abc",
      { kind: "slack", config: { questionIds: ["name"] } },
    );
    expect(ok.id).toBeTruthy();
  });
});
