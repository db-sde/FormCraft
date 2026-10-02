import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { getUsage, getWorkspacePlan, spendAiCredit } from "@/domains/billing";
import { completeResponse, startResponse } from "@/domains/responses";
import { prepareUpload } from "@/domains/uploads/queries";

/**
 * Plans and metering against the real database (migration 25): a
 * customer can't put themselves on a plan, completions are counted once,
 * AI credits stop at the plan's limit, and the plan's file ceiling
 * applies on top of the question's.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const runId = crypto.randomUUID().slice(0, 8);
const password = `Pw-${crypto.randomUUID()}`;

const schema = {
  schemaVersion: 1,
  meta: { title: "Plans" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    {
      id: "q1",
      type: "short_text",
      order: 0,
      label: "Name",
      required: true,
      settings: {},
    },
    {
      id: "q_file",
      type: "file_upload",
      order: 1,
      label: "File",
      required: false,
      settings: { acceptedMimeTypes: ["image/*"], maxSizeMb: 50 },
    },
  ],
  logic: [],
} as unknown as Json;

let userId: string;
let user: SupabaseClient<Database>;
let workspaceId: string;
let formId: string;

beforeAll(async () => {
  const email = `plans-${runId}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  userId = data.user.id;
  user = createClient<Database>(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const signedIn = await user.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  const { data: workspace, error: wsError } = await user.rpc(
    "create_workspace_with_owner",
    {
      workspace_name: "Plans",
      workspace_slug: `plans-${runId}`,
    },
  );
  if (wsError) throw wsError;
  workspaceId = workspace.id;

  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: "Plans",
      slug: `plans-${runId}`,
      created_by: userId,
    })
    .select("id")
    .single();
  formId = form!.id;
  await admin
    .from("form_versions")
    .insert({ form_id: formId, status: "draft", version_number: 1, schema });
  const { error: publishError } = await admin.rpc("publish_form_version", {
    target_form_id: formId,
    compiled_schema: schema,
  });
  if (publishError) throw publishError;
});

afterAll(async () => {
  if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("plans", () => {
  it("starts new workspaces on Free with no overrides", async () => {
    const plan = await getWorkspacePlan(admin, workspaceId);
    expect(plan.planId).toBe("free");
    expect(plan.entitlements.remove_branding).toBe(false);
  });

  it("won't let the owner change their own plan or overrides", async () => {
    const { error } = await user
      .from("workspaces")
      .update({
        name: "Renamed",
        plan_id: "enterprise",
        entitlement_overrides: { remove_branding: true },
      })
      .eq("id", workspaceId);
    expect(error).toBeNull();
    const { data } = await admin
      .from("workspaces")
      .select("name, plan_id, entitlement_overrides")
      .eq("id", workspaceId)
      .single();
    // The rename went through; the plan didn't.
    expect(data).toEqual({ name: "Renamed", plan_id: "free", entitlement_overrides: {} });
  });

  it("won't let a user create a workspace on a paid plan", async () => {
    const { data, error } = await user
      .from("workspaces")
      .insert({
        name: "Sneaky",
        slug: `plans-sneaky-${runId}`,
        owner_id: userId,
        plan_id: "business",
      })
      .select("plan_id, id")
      .single();
    expect(error).toBeNull();
    expect(data?.plan_id).toBe("free");
    await admin.from("workspaces").delete().eq("id", data!.id);
  });

  it("lets the service role assign a plan", async () => {
    await admin.from("workspaces").update({ plan_id: "pro" }).eq("id", workspaceId);
    const plan = await getWorkspacePlan(user, workspaceId);
    expect(plan).toMatchObject({ planId: "pro", planName: "Pro" });
    expect(plan.entitlements.remove_branding).toBe(true);
    await admin.from("workspaces").update({ plan_id: "free" }).eq("id", workspaceId);
  });
});

describe("usage", () => {
  it("counts a completed response once, even if completion is retried", async () => {
    const before = (await getUsage(user, workspaceId)).completedResponses;
    const started = await startResponse(admin, formId);
    const key = crypto.randomUUID();
    for (let i = 0; i < 2; i += 1) {
      await completeResponse(admin, started.responseId, 1, "q_file", { q1: "Ada" }, key);
    }
    expect((await getUsage(user, workspaceId)).completedResponses).toBe(before + 1);
  });

  it("stops AI credits at the plan's limit", async () => {
    await admin
      .from("workspaces")
      .update({ entitlement_overrides: { ai_credits_per_month: 2 } })
      .eq("id", workspaceId);
    const { entitlements } = await getWorkspacePlan(admin, workspaceId);
    const results = [];
    for (let i = 0; i < 3; i += 1) {
      results.push(await spendAiCredit(admin, workspaceId, entitlements));
    }
    expect(results).toEqual([true, true, false]);
    expect((await getUsage(user, workspaceId)).aiCredits).toBe(2);
  });

  it("doesn't let a user add usage themselves", async () => {
    const { error } = await user.rpc("increment_usage", {
      p_workspace_id: workspaceId,
      p_metric: "ai_credits",
      p_amount: -100,
    });
    expect(error).not.toBeNull();
  });

  it("caps uploads at the plan's size, under the question's", async () => {
    const started = await startResponse(admin, formId);
    // Free allows 10 MB; the question allows 50.
    expect((await prepareUpload(admin, started.responseId, "q_file")).maxBytes).toBe(
      10 * 1024 * 1024,
    );
    await admin
      .from("workspaces")
      .update({ entitlement_overrides: { upload_mb: 100 } })
      .eq("id", workspaceId);
    expect((await prepareUpload(admin, started.responseId, "q_file")).maxBytes).toBe(
      50 * 1024 * 1024,
    );
  });
});
