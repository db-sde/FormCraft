import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { publishForm } from "@/domains/forms";
import { listVersions, restoreVersionIntoDraft } from "@/domains/forms/versions/history";
import {
  completeResponse,
  purgeExpiredCompletedResponses,
  startResponse,
} from "@/domains/responses";
import { audit, listAuditLog } from "@/domains/audit";

/** Version history (P3.10), audit log (P3.14) and retention (P3.16)
 * against the real database. */
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

let owner: { id: string; client: SupabaseClient<Database> };
let editor: { id: string; client: SupabaseClient<Database> };
let workspaceId: string;
let formId: string;

async function signIn(label: string) {
  const email = `hist-${label}-${runId}@example.com`;
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

beforeAll(async () => {
  owner = await signIn("owner");
  editor = await signIn("editor");
  const { data: ws } = await owner.client.rpc("create_workspace_with_owner", {
    workspace_name: "History",
    workspace_slug: `hist-${runId}`,
  });
  workspaceId = ws!.id;
  await admin
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: editor.id, role: "editor" });
  const { data: form } = await owner.client
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: "History",
      slug: `hist-${runId}`,
      created_by: owner.id,
    })
    .select("id")
    .single();
  formId = form!.id;
  await admin.from("form_versions").insert({
    form_id: formId,
    status: "draft",
    version_number: 1,
    schema: schema("One"),
  });
});

afterAll(async () => {
  if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
  for (const p of [owner, editor]) if (p) await admin.auth.admin.deleteUser(p.id);
});

describe("version history", () => {
  it("records who published, and restoring changes only the draft", async () => {
    await publishForm(owner.client, formId, admin, owner.id);
    const { responseId } = await startResponse(admin, formId);
    await completeResponse(
      admin,
      responseId,
      1,
      "q1",
      { q1: "first" },
      crypto.randomUUID(),
    );

    await owner.client
      .from("form_versions")
      .update({ schema: schema("Two") })
      .eq("form_id", formId)
      .eq("status", "draft");
    await publishForm(owner.client, formId, admin, editor.id);

    const versions = await listVersions(owner.client, formId);
    expect(versions.map((v) => [v.versionNumber, v.status, v.responseCount])).toEqual([
      [3, "published", 0],
      [2, "archived", 1],
    ]);
    expect(versions[0].publishedBy).toContain("hist-editor");

    const old = versions[1];
    await restoreVersionIntoDraft(owner.client, formId, old.id);
    const { data: draft } = await admin
      .from("form_versions")
      .select("schema")
      .eq("form_id", formId)
      .eq("status", "draft")
      .single();
    expect((draft!.schema as { meta: { title: string } }).meta.title).toBe("One");
    // The live version and the response's link are untouched.
    const { data: live } = await admin
      .from("form_versions")
      .select("schema")
      .eq("form_id", formId)
      .eq("status", "published")
      .single();
    expect((live!.schema as { meta: { title: string } }).meta.title).toBe("Two");
    const { data: response } = await admin
      .from("responses")
      .select("form_version_id")
      .eq("id", responseId)
      .single();
    expect(response?.form_version_id).toBe(old.id);
  });
});

describe("audit log", () => {
  it("is readable by owners and admins only", async () => {
    await audit(admin, {
      workspaceId,
      actorId: owner.id,
      action: "form.published",
      target: { type: "form", id: formId },
      metadata: { version: 1 },
    });
    const records = await listAuditLog(owner.client, workspaceId);
    expect(records[0]).toMatchObject({
      action: "form.published",
      targetId: formId,
      metadata: { version: 1 },
    });
    expect(await listAuditLog(editor.client, workspaceId)).toEqual([]);
    const tamper = await owner.client
      .from("audit_logs")
      .delete()
      .eq("workspace_id", workspaceId)
      .select("id");
    expect(tamper.data ?? []).toEqual([]);
  });
});

describe("retention", () => {
  it("deletes only completed responses past the window, and logs it", async () => {
    const { responseId: oldId } = await startResponse(admin, formId);
    await completeResponse(admin, oldId, 1, "q1", { q1: "old" }, crypto.randomUUID());
    await admin
      .from("responses")
      .update({ completed_at: new Date(Date.now() - 40 * 86_400_000).toISOString() })
      .eq("id", oldId);
    const { responseId: newId } = await startResponse(admin, formId);
    await completeResponse(admin, newId, 1, "q1", { q1: "new" }, crypto.randomUUID());

    // No policy: nothing goes.
    expect((await purgeExpiredCompletedResponses(admin)).deleted).toBeGreaterThanOrEqual(
      0,
    );
    expect(
      (await admin.from("responses").select("id").eq("id", oldId)).data,
    ).toHaveLength(1);

    await admin
      .from("workspaces")
      .update({ response_retention_days: 30 })
      .eq("id", workspaceId);
    await purgeExpiredCompletedResponses(admin);
    expect((await admin.from("responses").select("id").eq("id", oldId)).data).toEqual([]);
    expect(
      (await admin.from("responses").select("id").eq("id", newId)).data,
    ).toHaveLength(1);
    const log = await listAuditLog(owner.client, workspaceId);
    expect(log.find((r) => r.action === "retention.purged")?.metadata).toMatchObject({
      days: 30,
    });
  });
});

describe("conversion by source (P3.8)", () => {
  it("groups by UTM source, then referring host, else Direct — skipping previews and spam", async () => {
    // Its own window, clear of the other tests' responses.
    const since = new Date(Date.now() + 3_600_000).toISOString();
    const { data: version } = await admin
      .from("form_versions")
      .select("id")
      .eq("form_id", formId)
      .eq("status", "published")
      .single();
    const row = (
      extra: Partial<Database["public"]["Tables"]["responses"]["Insert"]>,
    ) => ({
      form_id: formId,
      form_version_id: version!.id,
      started_at: new Date(Date.now() + 7_200_000).toISOString(),
      ...extra,
    });
    const { error } = await admin
      .from("responses")
      .insert(
        [
          row({ utm_source: "newsletter", referrer: "https://www.google.com/" }),
          row({ referrer: "https://www.google.com/search?q=x" }),
          row({ referrer: "http://news.ycombinator.com:443/item" }),
          row({}),
          row({ utm_source: "newsletter", is_preview: true }),
          row({ utm_source: "newsletter", spam_suspected: true }),
        ],
        { defaultToNull: false },
      );
    expect(error).toBeNull();

    const { data } = await owner.client.rpc("response_source_conversion", {
      target_form_id: formId,
      since,
    });
    expect([...(data ?? [])].sort((a, b) => a.source.localeCompare(b.source))).toEqual([
      { source: "Direct", started: 1, completed: 0 },
      { source: "google.com", started: 1, completed: 0 },
      { source: "news.ycombinator.com", started: 1, completed: 0 },
      { source: "newsletter", started: 1, completed: 0 },
    ]);
    // Someone who can't see responses gets nothing to aggregate.
    await admin
      .from("workspace_members")
      .update({ permissions: { view_responses: false } })
      .eq("workspace_id", workspaceId)
      .eq("user_id", editor.id);
    const { data: hidden } = await editor.client.rpc("response_source_conversion", {
      target_form_id: formId,
    });
    expect(hidden).toEqual([]);
  });
});
