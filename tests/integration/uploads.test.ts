import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { completeResponse, startResponse } from "@/domains/responses";
import {
  FileTooLargeError,
  prepareUpload,
  recordUpload,
  ResponseCompletedError,
  UnsupportedFileTypeError,
} from "@/domains/uploads";

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const runId = crypto.randomUUID().slice(0, 8);

const schema = {
  schemaVersion: 1,
  meta: { title: "Uploads" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    {
      id: "q_file",
      type: "file_upload",
      order: 0,
      label: "Photo",
      required: false,
      settings: { acceptedMimeTypes: ["image/*"], maxSizeMb: 1 },
    },
  ],
  logic: [],
} as unknown as Json;

// Smallest bytes the sniffer recognises as a PNG (it checks the signature).
const png = (size = 64) => {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
};

let userId: string;
let workspaceId: string;
let formId: string;

beforeAll(async () => {
  const { data: user, error } = await admin.auth.admin.createUser({
    email: `uploads-${runId}@example.com`,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  if (error) throw error;
  userId = user.user.id;
  const { data: workspace } = await admin
    .from("workspaces")
    .insert({ name: "Uploads", slug: `up-${runId}`, owner_id: userId })
    .select("id")
    .single();
  workspaceId = workspace!.id;
  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: "Uploads",
      slug: `up-form-${runId}`,
      created_by: userId,
    })
    .select("id")
    .single();
  formId = form!.id;
  await admin
    .from("form_versions")
    .insert({ form_id: formId, status: "draft", version_number: 1, schema });
  await admin.rpc("publish_form_version", {
    target_form_id: formId,
    compiled_schema: schema,
  });
}, 60_000);

afterAll(async () => {
  const { data: files } = await admin
    .from("uploads")
    .select("storage_path, responses!inner(form_id)")
    .eq("responses.form_id", formId);
  if (files?.length) {
    await admin.storage.from("response-uploads").remove(files.map((f) => f.storage_path));
  }
  await admin.from("workspaces").delete().eq("id", workspaceId);
  await admin.auth.admin.deleteUser(userId);
});

describe("recordUpload", () => {
  it("refuses a file for a response that was already submitted", async () => {
    const { responseId } = await startResponse(admin, formId);
    await completeResponse(admin, responseId, 1, "q_file", {}, crypto.randomUUID());
    await expect(prepareUpload(admin, responseId, "q_file")).rejects.toBeInstanceOf(
      ResponseCompletedError,
    );
    await expect(
      recordUpload(admin, responseId, "q_file", {
        bytes: png(),
        originalFilename: "late.png",
      }),
    ).rejects.toBeInstanceOf(ResponseCompletedError);
  });

  it("reports the question's size limit before any bytes are read", async () => {
    const { responseId } = await startResponse(admin, formId);
    const prepared = await prepareUpload(admin, responseId, "q_file");
    expect(prepared.maxBytes).toBe(1024 * 1024);
    await expect(
      recordUpload(admin, responseId, "q_file", {
        bytes: png(1024 * 1024 + 1),
        originalFilename: "big.png",
      }),
    ).rejects.toBeInstanceOf(FileTooLargeError);
  });

  it("rejects content that isn't an accepted type, whatever it's called", async () => {
    const { responseId } = await startResponse(admin, formId);
    await expect(
      recordUpload(admin, responseId, "q_file", {
        bytes: new TextEncoder().encode("<script>alert(1)</script>"),
        originalFilename: "totally-an-image.png",
      }),
    ).rejects.toBeInstanceOf(UnsupportedFileTypeError);
  });

  it("replaces the earlier file when the same question is uploaded again", async () => {
    const { responseId } = await startResponse(admin, formId);
    const first = await recordUpload(admin, responseId, "q_file", {
      bytes: png(),
      originalFilename: "one.png",
    });
    const second = await recordUpload(admin, responseId, "q_file", {
      bytes: png(),
      originalFilename: "two.png",
    });
    const { data: rows } = await admin
      .from("uploads")
      .select("id, original_filename")
      .eq("response_id", responseId);
    expect(rows).toEqual([{ id: second.uploadId, original_filename: "two.png" }]);
    expect(rows?.some((r) => r.id === first.uploadId)).toBe(false);
  });
});
