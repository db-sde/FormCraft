import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { completeResponse, startResponse } from "@/domains/responses";
import {
  createExperiment,
  ExperimentError,
  listExperiments,
  stopExperiment,
} from "@/domains/experiments";

/** A/B tests (P3.9) against the real database: who may run them, both
 * arms in one workspace, no chains, tagging only by a real running test,
 * per-arm counts, and choosing B copies it into A's draft. */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const runId = crypto.randomUUID().slice(0, 8);
const password = `Pw-${crypto.randomUUID()}`;
const schema = (title: string) =>
  ({
    schemaVersion: 1,
    meta: { title },
    theme: {},
    endings: [{ id: "end", title: "Thanks", isDefault: true }],
    questions: [
      {
        id: "q1",
        type: "short_text",
        order: 0,
        label: title,
        required: true,
        settings: {},
      },
    ],
    logic: [],
  }) as unknown as Json;

type Person = { id: string; client: SupabaseClient<Database> };
let owner: Person;
let viewer: Person;
let stranger: Person;
let workspaceId: string;
let otherWorkspaceId: string;
let formA: string;
let formB: string;
let formC: string;
let foreignForm: string;

async function signIn(label: string): Promise<Person> {
  const email = `ab-${label}-${runId}@example.com`;
  const { data } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  const client = createClient<Database>(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  await client.auth.signInWithPassword({ email, password });
  return { id: data.user!.id, client };
}

async function publishedForm(ws: string, by: string, title: string): Promise<string> {
  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: ws,
      title,
      slug: `ab-${title.toLowerCase()}-${runId}`,
      created_by: by,
    })
    .select("id")
    .single();
  await admin.from("form_versions").insert({
    form_id: form!.id,
    status: "draft",
    version_number: 1,
    schema: schema(title),
  });
  const { error } = await admin.rpc("publish_form_version", {
    target_form_id: form!.id,
    compiled_schema: schema(title),
  });
  if (error) throw error;
  return form!.id;
}

beforeAll(async () => {
  owner = await signIn("owner");
  viewer = await signIn("viewer");
  stranger = await signIn("stranger");
  const { data: ws } = await owner.client.rpc("create_workspace_with_owner", {
    workspace_name: "AB",
    workspace_slug: `ab-${runId}`,
  });
  workspaceId = ws!.id;
  await admin.from("workspaces").update({ plan_id: "business" }).eq("id", workspaceId);
  await admin
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: viewer.id, role: "viewer" });
  const { data: other } = await stranger.client.rpc("create_workspace_with_owner", {
    workspace_name: "Other",
    workspace_slug: `ab-other-${runId}`,
  });
  otherWorkspaceId = other!.id;
  formA = await publishedForm(workspaceId, owner.id, "Alpha");
  formB = await publishedForm(workspaceId, owner.id, "Beta");
  formC = await publishedForm(workspaceId, owner.id, "Gamma");
  foreignForm = await publishedForm(otherWorkspaceId, stranger.id, "Foreign");
});

afterAll(async () => {
  for (const ws of [workspaceId, otherWorkspaceId])
    if (ws) await admin.from("workspaces").delete().eq("id", ws);
  for (const p of [owner, viewer, stranger])
    if (p) await admin.auth.admin.deleteUser(p.id);
});

describe("A/B tests", () => {
  let testId: string;

  it("are started only by publishers, with both arms in the workspace", async () => {
    const input = {
      workspaceId,
      formId: formA,
      variantFormId: formB,
      name: "Shorter intro",
      split: 30,
    };
    await expect(
      createExperiment(viewer.client, { ...input, createdBy: viewer.id }),
    ).rejects.toThrow(ExperimentError);
    await expect(
      createExperiment(owner.client, {
        ...input,
        variantFormId: foreignForm,
        createdBy: owner.id,
      }),
    ).rejects.toThrow("Version B must be a published form in this workspace.");
    // The database refuses a cross-workspace arm too, whoever writes it.
    const forged = await admin.from("experiments").insert({
      workspace_id: workspaceId,
      form_id: formA,
      variant_form_id: foreignForm,
      name: "x",
    });
    expect(forged.error?.message).toContain("Both forms must be in");

    testId = await createExperiment(owner.client, { ...input, createdBy: owner.id });
    // No second test on A, and no chains through B.
    await expect(
      createExperiment(owner.client, {
        ...input,
        variantFormId: formC,
        createdBy: owner.id,
      }),
    ).rejects.toThrow("already in a running test");
    await expect(
      createExperiment(owner.client, {
        ...input,
        formId: formC,
        variantFormId: formB,
        createdBy: owner.id,
      }),
    ).rejects.toThrow("already in a running test");
  });

  it("tag responses only for a real arm of a running test, and count per arm", async () => {
    const run = async (formId: string, experimentId: string, finish: boolean) => {
      const { responseId } = await startResponse(admin, formId, { experimentId });
      if (finish)
        await completeResponse(
          admin,
          responseId,
          1,
          "q1",
          { q1: "x" },
          crypto.randomUUID(),
        );
      return responseId;
    };
    await run(formA, testId, true);
    await run(formA, testId, false);
    await run(formB, testId, true);
    // A browser claiming the test for an unrelated form isn't believed.
    const forged = await run(formC, testId, true);
    const { data } = await admin
      .from("responses")
      .select("experiment_id")
      .eq("id", forged)
      .single();
    expect(data?.experiment_id).toBeNull();

    const [test] = await listExperiments(owner.client, formA);
    expect(test.arms).toEqual({
      a: { started: 2, completed: 1, rate: 0.5 },
      b: { started: 1, completed: 1, rate: 1 },
    });
    expect(test.verdict.kind).toBe("collecting");
    expect(test.variantTitle).toBe("Beta");
  });

  it("choosing B ends the test and puts B into A's draft, not live", async () => {
    await expect(stopExperiment(viewer.client, testId, "b")).rejects.toThrow(
      ExperimentError,
    );
    expect(await stopExperiment(owner.client, testId, "b")).toEqual({
      copiedIntoDraft: true,
    });
    const versions = await admin
      .from("form_versions")
      .select("status, schema")
      .eq("form_id", formA);
    const title = (status: string) =>
      (
        versions.data!.find((v) => v.status === status)!.schema as {
          meta: { title: string };
        }
      ).meta.title;
    expect(title("draft")).toBe("Beta");
    expect(title("published")).toBe("Alpha");

    const restart = await admin
      .from("experiments")
      .update({ status: "running", ended_at: null, winner: null })
      .eq("id", testId);
    expect(restart.error?.message).toContain("can't restart");
    // New responses aren't tagged with a stopped test.
    const { responseId } = await startResponse(admin, formA, { experimentId: testId });
    const { data } = await admin
      .from("responses")
      .select("experiment_id")
      .eq("id", responseId)
      .single();
    expect(data?.experiment_id).toBeNull();
  });
});
