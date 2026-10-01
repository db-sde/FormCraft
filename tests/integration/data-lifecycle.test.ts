import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { deleteAccount } from "@/domains/identity";
import { buildLeadsCsv, countLeads, listLeads } from "@/domains/leads";
import {
  completeResponse,
  deleteResponse,
  getAdjacentResponseIds,
  listResponses,
  purgeDeletedForms,
  purgeExpiredUnfinishedResponses,
  saveResponseAnswers,
  startResponse,
} from "@/domains/responses";

/**
 * Boundaries and lifecycles against the real database and Storage:
 * deletion cleans up files, work isn't silently capped at 1000 rows
 * (PostgREST's per-request limit), equal timestamps don't hide rows,
 * and leads are exact. Each test checks the state left behind, not just
 * a return value.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin: SupabaseClient<Database> = createClient<Database>(
  url,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const runId = crypto.randomUUID().slice(0, 8);
const password = `Pw-${crypto.randomUUID()}`;
const BUCKET = "response-uploads";

type Tenant = { userId: string; workspaceId: string; client: SupabaseClient<Database> };
const created: string[] = [];

async function makeTenant(label: string): Promise<Tenant> {
  const email = `life-${label}-${runId}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  created.push(data.user.id);
  const client = createClient<Database>(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  await client.auth.signInWithPassword({ email, password });
  const { data: workspace, error: wsError } = await client.rpc(
    "create_workspace_with_owner",
    {
      workspace_name: `${label} workspace`,
      workspace_slug: `life-${label}-${runId}`,
    },
  );
  if (wsError) throw wsError;
  return { userId: data.user.id, workspaceId: workspace.id, client };
}

const fileSchema = {
  schemaVersion: 1,
  meta: { title: "Files" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    {
      id: "q_name",
      type: "short_text",
      order: 0,
      label: "Name",
      required: false,
      settings: {},
    },
    {
      id: "q_file",
      type: "file_upload",
      order: 1,
      label: "File",
      required: false,
      settings: { acceptedMimeTypes: ["image/*"], maxSizeMb: 1 },
    },
  ],
  logic: [],
} as unknown as Json;

async function makeForm(tenant: Tenant, label: string, schema: Json = fileSchema) {
  const { data: form, error } = await admin
    .from("forms")
    .insert({
      workspace_id: tenant.workspaceId,
      title: label,
      slug: `life-${label}-${runId}-${crypto.randomUUID().slice(0, 5)}`,
      created_by: tenant.userId,
    })
    .select("id")
    .single();
  if (error) throw error;
  await admin
    .from("form_versions")
    .insert({ form_id: form.id, status: "draft", version_number: 1, schema });
  await admin.rpc("publish_form_version", {
    target_form_id: form.id,
    compiled_schema: schema,
  });
  return form.id;
}

async function objectExists(path: string) {
  const { data } = await admin.storage.from(BUCKET).download(path);
  return data !== null;
}

async function putObject(path: string) {
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(path, new Blob(["file"]), { contentType: "text/plain", upsert: true });
  if (error) throw error;
}

async function addUpload(responseId: string, path: string, id?: string) {
  const { error } = await admin.from("uploads").insert({
    ...(id ? { id } : {}),
    response_id: responseId,
    question_id: "q_file",
    storage_path: path,
    original_filename: "f.txt",
    mime_type: "text/plain",
    size_bytes: 4,
    status: "clean",
  });
  if (error) throw error;
}

let owner: Tenant;
let other: Tenant;

beforeAll(async () => {
  owner = await makeTenant("owner");
  other = await makeTenant("other");
}, 60_000);

afterAll(async () => {
  for (const userId of created) {
    await admin.from("workspaces").delete().eq("owner_id", userId);
    await admin.auth.admin.deleteUser(userId);
  }
}, 120_000);

describe("deleting a response", () => {
  it("removes its uploaded files from Storage, not just the database row", async () => {
    const formId = await makeForm(owner, "del-response");
    const { responseId } = await startResponse(admin, formId);
    const path = `${responseId}/q_file/a.txt`;
    await putObject(path);
    await addUpload(responseId, path);

    expect(await deleteResponse(owner.client, responseId, admin)).toBe(true);

    const { data } = await admin.from("responses").select("id").eq("id", responseId);
    expect(data).toEqual([]);
    expect(await objectExists(path)).toBe(false);
  });

  it("does nothing, and keeps the files, when the caller isn't a member", async () => {
    const formId = await makeForm(owner, "del-denied");
    const { responseId } = await startResponse(admin, formId);
    const path = `${responseId}/q_file/keep.txt`;
    await putObject(path);
    await addUpload(responseId, path);

    expect(await deleteResponse(other.client, responseId, admin)).toBe(false);

    const { data } = await admin.from("responses").select("id").eq("id", responseId);
    expect(data).toHaveLength(1);
    expect(await objectExists(path)).toBe(true);
  });
});

describe("cleanup beyond 1000 records", () => {
  /** A form with 1,050 upload rows whose real files sort AFTER the first
   * 1000 by id — the ones a capped query used to miss. */
  async function formWithManyUploads(tenant: Tenant, label: string) {
    const formId = await makeForm(tenant, label);
    const { responseId } = await startResponse(admin, formId);
    const rows = Array.from({ length: 1050 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      response_id: responseId,
      question_id: `q_${i}`,
      storage_path: `${responseId}/fake/${i}.txt`,
      original_filename: "f.txt",
      mime_type: "text/plain",
      size_bytes: 4,
      status: "clean" as const,
    }));
    for (let i = 0; i < rows.length; i += 250) {
      const { error } = await admin.from("uploads").insert(rows.slice(i, i + 250));
      if (error) throw error;
    }
    const realPaths = [0, 1, 2].map((n) => `${responseId}/real/${n}.txt`);
    for (const [n, path] of realPaths.entries()) {
      await putObject(path);
      await addUpload(
        responseId,
        path,
        `ffffffff-0000-4000-8000-${String(n).padStart(12, "0")}`,
      );
    }
    return { formId, responseId, realPaths };
  }

  it("account deletion removes every file, including those past the first page", async () => {
    const tenant = await makeTenant("account");
    const { realPaths, formId } = await formWithManyUploads(tenant, "acct");
    await putObject(`${tenant.workspaceId}/logo-${runId}.png`);

    await deleteAccount(admin, tenant.userId);

    for (const path of realPaths) expect(await objectExists(path), path).toBe(false);
    const { data: assets } = await admin.storage
      .from("theme-assets")
      .list(tenant.workspaceId);
    expect(assets ?? []).toEqual([]);
    expect((await admin.from("forms").select("id").eq("id", formId)).data).toEqual([]);
    expect((await admin.auth.admin.getUserById(tenant.userId)).data.user).toBeNull();
  }, 120_000);

  it("retention removes the files of every expired response, not just the first thousand", async () => {
    const tenant = await makeTenant("retention");
    const { formId, responseId, realPaths } = await formWithManyUploads(tenant, "ret");
    await admin
      .from("responses")
      .update({ last_active_at: new Date(Date.now() - 90 * 86_400_000).toISOString() })
      .eq("id", responseId);
    await admin.from("forms").update({ partial_retention_days: 30 }).eq("id", formId);

    await purgeExpiredUnfinishedResponses(admin);

    expect(
      (await admin.from("responses").select("id").eq("id", responseId)).data,
    ).toEqual([]);
    for (const path of realPaths) expect(await objectExists(path), path).toBe(false);
  }, 120_000);
});

describe("deleted forms", () => {
  it("are purged with their files after the grace period, not before", async () => {
    const oldForm = await makeForm(owner, "gone-old");
    const recentForm = await makeForm(owner, "gone-recent");
    const { responseId } = await startResponse(admin, oldForm);
    const path = `${responseId}/q_file/old.txt`;
    await putObject(path);
    await addUpload(responseId, path);

    await admin
      .from("forms")
      .update({ deleted_at: new Date(Date.now() - 31 * 86_400_000).toISOString() })
      .eq("id", oldForm);
    await admin
      .from("forms")
      .update({ deleted_at: new Date(Date.now() - 5 * 86_400_000).toISOString() })
      .eq("id", recentForm);

    const { purged } = await purgeDeletedForms(admin);
    expect(purged).toBeGreaterThanOrEqual(1);

    expect((await admin.from("forms").select("id").eq("id", oldForm)).data).toEqual([]);
    expect(await objectExists(path)).toBe(false);
    expect(
      (await admin.from("forms").select("id").eq("id", recentForm)).data,
    ).toHaveLength(1);
  });
});

describe("response lists", () => {
  it("shows correct progress for a full page of 25 long responses (1,125 answers)", async () => {
    const questions = Array.from({ length: 50 }, (_, i) => ({
      id: `q${i}`,
      type: "short_text",
      order: i,
      label: `Q${i}`,
      required: false,
      settings: {},
    }));
    const schema = {
      schemaVersion: 1,
      meta: { title: "Long" },
      theme: {},
      endings: [{ id: "end", title: "Thanks", isDefault: true }],
      questions,
      logic: [],
    } as unknown as Json;
    const formId = await makeForm(owner, "long", schema);

    const responseIds: string[] = [];
    for (let r = 0; r < 25; r += 1) {
      const { responseId } = await startResponse(admin, formId);
      responseIds.push(responseId);
      await saveResponseAnswers(
        admin,
        responseId,
        1,
        "q44",
        Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`q${i}`, `a${i}`])),
      );
    }

    const page = await listResponses(owner.client, formId, { view: "incomplete" });
    expect(page.items).toHaveLength(25);
    for (const item of page.items) {
      expect(item.progress, item.id).toEqual({ answered: 45, total: 50 });
    }
  }, 120_000);

  it("steps through responses that share the exact same timestamp without skipping any", async () => {
    const formId = await makeForm(owner, "ties");
    const sameInstant = new Date("2026-01-01T12:00:00.000Z").toISOString();
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const { responseId } = await startResponse(admin, formId);
      await completeResponse(
        admin,
        responseId,
        1,
        "q_name",
        { q_name: `n${i}` },
        crypto.randomUUID(),
      );
      await admin
        .from("responses")
        .update({ completed_at: sameInstant })
        .eq("id", responseId);
      ids.push(responseId);
    }

    // The order the list shows is the order prev/next must walk.
    const listed = (await listResponses(owner.client, formId)).items.map((i) => i.id);
    expect(new Set(listed)).toEqual(new Set(ids));

    const walked: string[] = [listed[0]];
    for (;;) {
      const current = walked[walked.length - 1];
      const { olderId } = await getAdjacentResponseIds(owner.client, formId, {
        id: current,
        status: "completed",
        completedAt: sameInstant,
        lastActiveAt: sameInstant,
      });
      if (!olderId) break;
      walked.push(olderId);
    }
    expect(walked).toEqual(listed);
  });
});

describe("leads", () => {
  const contactSchema = (blocks = 1) =>
    ({
      schemaVersion: 1,
      meta: { title: "Leads" },
      theme: {},
      endings: [{ id: "end", title: "Thanks", isDefault: true }],
      questions: Array.from({ length: blocks }, (_, i) => ({
        id: `q_contact${i}`,
        type: "contact_info",
        order: i,
        label: `Contact ${i}`,
        required: false,
        settings: { fields: ["name", "email"], requiredFields: [] },
      })),
      logic: [],
    }) as unknown as Json;

  it("finds a form among more than 1,000 in the workspace", async () => {
    const tenant = await makeTenant("many-forms");
    const formRows = Array.from({ length: 1010 }, (_, i) => ({
      id: `00000000-0000-4000-9000-${String(i).padStart(12, "0")}`,
      workspace_id: tenant.workspaceId,
      title: `bulk ${i}`,
      slug: `bulk-${runId}-${tenant.userId.slice(0, 4)}-${i}`,
      created_by: tenant.userId,
    }));
    for (let i = 0; i < formRows.length; i += 250) {
      const { error } = await admin.from("forms").insert(formRows.slice(i, i + 250));
      if (error) throw error;
    }
    const lastFormId = formRows[formRows.length - 1].id;
    await admin.from("form_versions").insert(
      formRows.map((f) => ({
        form_id: f.id,
        status: "draft" as const,
        version_number: 1,
        schema: f.id === lastFormId ? contactSchema() : fileSchema,
      })),
    );
    await admin.rpc("publish_form_version", {
      target_form_id: lastFormId,
      compiled_schema: contactSchema(),
    });
    const { responseId } = await startResponse(admin, lastFormId);
    await saveResponseAnswers(admin, responseId, 1, "q_contact0", {
      q_contact0: { name: "Found Me", email: "found@example.com" },
    });

    const page = await listLeads(tenant.client, tenant.workspaceId);
    expect(page.items.map((l) => l.name)).toEqual(["Found Me"]);
    expect(await countLeads(tenant.client, tenant.workspaceId)).toBe(1);
  }, 180_000);

  it("counts a response with two contact blocks once, and ignores a cleared block", async () => {
    const tenant = await makeTenant("leads");
    const formId = await makeForm(tenant, "two-blocks", contactSchema(2));

    const both = (await startResponse(admin, formId)).responseId;
    await saveResponseAnswers(admin, both, 1, "q_contact1", {
      q_contact0: { name: "Primary", email: "primary@example.com" },
      q_contact1: { name: "Secondary", email: "secondary@example.com" },
    });
    const cleared = (await startResponse(admin, formId)).responseId;
    await saveResponseAnswers(admin, cleared, 1, "q_contact0", {
      q_contact0: { name: "Was Here" },
    });
    // They emptied every field afterwards.
    await saveResponseAnswers(admin, cleared, 2, "q_contact0", { q_contact0: {} });

    const page = await listLeads(tenant.client, tenant.workspaceId);
    expect(page.totalCount).toBe(1);
    expect(page.items.map((l) => l.name)).toEqual(["Primary"]);
  });

  it("searches, pages with exact totals, exports, and never shows another workspace's leads", async () => {
    const tenant = await makeTenant("leads-page");
    const formId = await makeForm(tenant, "paged", contactSchema());
    for (let i = 0; i < 30; i += 1) {
      const { responseId } = await startResponse(admin, formId);
      await saveResponseAnswers(admin, responseId, 1, "q_contact0", {
        q_contact0: {
          name: `Person ${String(i).padStart(2, "0")}`,
          email: `p${i}@example.com`,
        },
      });
    }

    const first = await listLeads(tenant.client, tenant.workspaceId, { page: 1 });
    const second = await listLeads(tenant.client, tenant.workspaceId, { page: 2 });
    const beyond = await listLeads(tenant.client, tenant.workspaceId, { page: 9 });
    expect([first.items.length, second.items.length]).toEqual([25, 5]);
    expect([first.totalCount, second.totalCount, beyond.totalCount]).toEqual([
      30, 30, 30,
    ]);
    expect(beyond.items).toEqual([]);
    expect(new Set([...first.items, ...second.items].map((l) => l.responseId)).size).toBe(
      30,
    );

    const hit = await listLeads(tenant.client, tenant.workspaceId, {
      search: "person 07",
    });
    expect(hit.items.map((l) => l.name)).toEqual(["Person 07"]);
    // LIKE wildcards in a search are literal, not patterns.
    expect(
      (await listLeads(tenant.client, tenant.workspaceId, { search: "%" })).totalCount,
    ).toBe(0);

    const csv = await buildLeadsCsv(tenant.client, tenant.workspaceId);
    expect(csv.trimEnd().split("\r\n")).toHaveLength(31);

    // Another signed-in user, asking about this workspace directly.
    expect((await listLeads(other.client, tenant.workspaceId)).totalCount).toBe(0);
  }, 120_000);
});
