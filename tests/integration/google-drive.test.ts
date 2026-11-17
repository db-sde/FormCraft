import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import "@/domains/connectors/registry";
import { dispatchConnectorJobs, saveConnection } from "@/domains/connectors/framework";
import { enqueueConnectorSyncs } from "@/domains/connectors/links";
import { safeDriveName } from "@/domains/connectors/providers/google-drive";

/**
 * Google Drive (F-50, migration 64) against the real database and
 * storage, with Drive faked at the fetch level: files land in a folder
 * made for the form (and one per response), a retry never uploads a
 * file twice, and a response without files is skipped.
 */
const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const runId = crypto.randomUUID().slice(0, 8);
const schema = {
  schemaVersion: 1,
  meta: { title: "Applications" },
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
      id: "q_cv",
      type: "file_upload",
      order: 1,
      label: "Your CV",
      required: false,
      settings: { acceptedMimeTypes: ["application/pdf"], maxSizeMb: 5 },
    },
  ],
  logic: [],
} as unknown as Json;

/** Drive, faked: folders and files with their tags, searched by tag. */
type DriveItem = {
  id: string;
  name: string;
  mimeType?: string;
  parents?: string[];
  appProperties: Record<string, string>;
  bytes?: number;
};
const drive: DriveItem[] = [];
let failNextPut = false;
const sessions = new Map<string, DriveItem>();
const fakeDrive = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = new URL(String(input));
  const method = init?.method ?? "GET";
  const json = (status: number, data: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(data), { status, headers });
  if (method === "GET" && u.pathname === "/drive/v3/files") {
    const q = u.searchParams.get("q") ?? "";
    const tags = [...q.matchAll(/key='([^']+)' and value='([^']+)'/g)];
    const parent = /'([^']+)' in parents/.exec(q)?.[1];
    const folderOnly = q.includes("mimeType='application/vnd.google-apps.folder'");
    const files = drive.filter(
      (f) =>
        tags.every(([, k, v]) => f.appProperties[k] === v) &&
        (!parent || f.parents?.includes(parent)) &&
        (!folderOnly || f.mimeType === "application/vnd.google-apps.folder"),
    );
    return json(200, { files: files.map(({ id, name }) => ({ id, name })) });
  }
  if (method === "POST" && u.pathname === "/drive/v3/files") {
    const body = JSON.parse(String(init?.body));
    const item = {
      id: `d_${drive.length + 1}`,
      ...body,
      appProperties: body.appProperties ?? {},
    };
    drive.push(item);
    return json(200, { id: item.id });
  }
  if (method === "PATCH" && u.pathname.startsWith("/drive/v3/files/")) {
    const item = drive.find((f) => u.pathname.endsWith(f.id));
    Object.assign(item!.appProperties, JSON.parse(String(init?.body)).appProperties);
    return json(200, { id: item!.id });
  }
  if (method === "POST" && u.pathname === "/upload/drive/v3/files") {
    const body = JSON.parse(String(init?.body));
    const session = `${u.origin}/session/${sessions.size + 1}`;
    sessions.set(session, { id: "", ...body });
    return json(200, {}, { location: session });
  }
  if (method === "PUT" && sessions.has(String(input))) {
    if (failNextPut) {
      failNextPut = false;
      return json(503, { error: "backend error" });
    }
    const meta = sessions.get(String(input))!;
    drive.push({
      ...meta,
      id: `d_${drive.length + 1}`,
      bytes: (init?.body as Uint8Array).byteLength,
    });
    return json(200, { id: "ok" });
  }
  return json(404, { error: `no route ${method} ${u.pathname}` });
}) as typeof fetch;

let userId: string;
let workspaceId: string;
let formId: string;
let versionId: string;
const storagePaths: string[] = [];

async function respondWith(file: { name: string; bytes: Uint8Array } | null) {
  const { data: r } = await admin
    .from("responses")
    .insert({
      form_id: formId,
      form_version_id: versionId,
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  const answers: { response_id: string; question_id: string; value: Json }[] = [
    { response_id: r!.id, question_id: "q_name", value: "Ada" },
  ];
  if (file) {
    const path = `${r!.id}/q_cv/${crypto.randomUUID()}.pdf`;
    const { error } = await admin.storage
      .from("response-uploads")
      .upload(path, file.bytes, { contentType: "application/pdf" });
    if (error) throw error;
    storagePaths.push(path);
    const { data: upload } = await admin
      .from("uploads")
      .insert({
        response_id: r!.id,
        question_id: "q_cv",
        storage_path: path,
        original_filename: file.name,
        mime_type: "application/pdf",
        size_bytes: file.bytes.byteLength,
      })
      .select("id")
      .single();
    answers.push({ response_id: r!.id, question_id: "q_cv", value: upload!.id });
  }
  await admin.from("answers").insert(answers);
  return r!.id;
}

const job = async (responseId: string) =>
  (
    await admin
      .from("connector_jobs")
      .select("status, last_error, result")
      .eq("response_id", responseId)
      .single()
  ).data!;

async function sync(responseId: string) {
  await enqueueConnectorSyncs(admin, responseId, { dispatch: false });
  await dispatchConnectorJobs(admin, { fetch: fakeDrive, responseId });
}

beforeAll(async () => {
  const { data: user } = await admin.auth.admin.createUser({
    email: `drive-${runId}@example.com`,
    password: `Pw-${crypto.randomUUID()}`,
    email_confirm: true,
  });
  userId = user.user!.id;
  const { data: ws } = await admin
    .from("workspaces")
    .insert({
      name: "Drive",
      slug: `drive-${runId}`,
      owner_id: userId,
      plan_id: "business",
    })
    .select("id")
    .single();
  workspaceId = ws!.id;
  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: "Applications",
      slug: `drive-${runId}`,
      created_by: userId,
    })
    .select("id")
    .single();
  formId = form!.id;
  const { error } = await admin.rpc("publish_form_version", {
    target_form_id: formId,
    compiled_schema: schema,
  });
  if (error) throw error;
  versionId = (
    await admin
      .from("form_versions")
      .select("id")
      .eq("form_id", formId)
      .eq("status", "published")
      .single()
  ).data!.id;
  await saveConnection(admin, {
    workspaceId,
    userId: null,
    provider: "google_drive",
    tokens: { accessToken: "drive-token" },
    label: "drive@example.com",
    createdBy: userId,
  });
  await admin.from("connector_links").insert({
    form_id: formId,
    provider: "google_drive",
    settings: { folderId: "new", perResponseFolder: true },
    mapping: [],
  });
}, 60_000);

afterAll(async () => {
  if (storagePaths.length)
    await admin.storage.from("response-uploads").remove(storagePaths);
  if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("Google Drive (F-50)", () => {
  it("copies a response's file into the form's folder, in its own folder", async () => {
    const responseId = await respondWith({
      name: "cv/../ada.pdf",
      bytes: new TextEncoder().encode("%PDF-1.4 cv"),
    });
    await sync(responseId);
    expect(await job(responseId)).toMatchObject({ status: "succeeded" });

    const formFolder = drive.find((f) => f.appProperties.fc_form === formId && !f.bytes)!;
    expect(formFolder.name).toBe("FormCraft · Applications");
    expect(formFolder.appProperties.fc_kind).toBe("form_folder");
    const responseFolder = drive.find(
      (f) => f.appProperties.fc_response === responseId && !f.bytes,
    )!;
    expect(responseFolder.parents).toEqual([formFolder.id]);
    const file = drive.find((f) => f.appProperties.fc_upload)!;
    expect(file.parents).toEqual([responseFolder.id]);
    // The name can't climb out of the folder or upset a sync client.
    expect(file.name).toBe("Your CV - cv .. ada.pdf");
    expect(file.bytes).toBe(11);
  });

  it("never uploads a file twice: a failed upload retries, a repeat finds it", async () => {
    const responseId = await respondWith({
      name: "second.pdf",
      bytes: new TextEncoder().encode("%PDF-1.4 two"),
    });
    failNextPut = true;
    await sync(responseId);
    expect(await job(responseId)).toMatchObject({ status: "failed" });

    await admin
      .from("connector_jobs")
      .update({ next_attempt_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("response_id", responseId);
    await dispatchConnectorJobs(admin, { fetch: fakeDrive, responseId });
    const retried = await job(responseId);
    expect(retried, retried.last_error ?? "").toMatchObject({ status: "succeeded" });
    // Run again by hand: found by its tag, not uploaded again.
    await admin
      .from("connector_jobs")
      .update({
        status: "pending",
        next_attempt_at: new Date(Date.now() - 60_000).toISOString(),
      })
      .eq("response_id", responseId);
    await dispatchConnectorJobs(admin, { fetch: fakeDrive, responseId });
    const copies = drive.filter(
      (f) => f.bytes && f.appProperties.fc_response === responseId,
    );
    expect(copies).toHaveLength(1);
    // One folder for the form, however many responses.
    expect(
      drive.filter((f) => f.appProperties.fc_form === formId && !f.bytes),
    ).toHaveLength(1);
  });

  it("skips a response with no files", async () => {
    const responseId = await respondWith(null);
    await sync(responseId);
    expect(await job(responseId)).toMatchObject({ status: "skipped" });
  });

  it("makes names safe", () => {
    expect(safeDriveName('..\\a:b*c?"d<e>f|g')).toBe("a b c d e f g");
    expect(safeDriveName("")).toBe("file");
    expect(safeDriveName("x".repeat(400))).toHaveLength(180);
  });
});
