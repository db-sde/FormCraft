import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  createFormWithDraft,
  duplicateForm,
  updatePartialResponseSettings,
} from "@/domains/forms";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const runId = crypto.randomUUID().slice(0, 8);

const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Original" },
  theme: {
    primaryColor: "#0f172a",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end_default", title: "Thanks", isDefault: true }],
  questions: [
    {
      id: "q1",
      type: "short_text",
      order: 0,
      label: "Name",
      required: true,
      settings: {},
    },
  ],
  logic: [],
};

let userId: string;
let workspaceId: string;

beforeAll(async () => {
  const { data: user, error } = await admin.auth.admin.createUser({
    email: `dup-${runId}@example.com`,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  if (error) throw error;
  userId = user.user.id;
  const { data: workspace } = await admin
    .from("workspaces")
    .insert({ name: "Dup", slug: `dup-${runId}`, owner_id: userId })
    .select("id")
    .single();
  workspaceId = workspace!.id;
}, 30_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", workspaceId);
  await admin.auth.admin.deleteUser(userId);
});

describe("duplicateForm", () => {
  it("keeps how the original treats unfinished responses", async () => {
    const original = await createFormWithDraft(
      admin,
      workspaceId,
      userId,
      "Original",
      schema,
    );
    await updatePartialResponseSettings(admin, original.id, workspaceId, {
      savePartialResponses: false,
      partialRetentionDays: 30,
    });

    const copy = await duplicateForm(admin, original.id, workspaceId, userId);
    expect(copy).not.toBeNull();

    const { data: row } = await admin
      .from("forms")
      .select("title, save_partial_responses, partial_retention_days")
      .eq("id", copy!.id)
      .single();
    expect(row).toEqual({
      title: "Original (copy)",
      save_partial_responses: false,
      partial_retention_days: 30,
    });
  });

  it("never copies publish state", async () => {
    const original = await createFormWithDraft(
      admin,
      workspaceId,
      userId,
      "Live",
      schema,
    );
    const copy = await duplicateForm(admin, original.id, workspaceId, userId);
    const { data: versions } = await admin
      .from("form_versions")
      .select("status")
      .eq("form_id", copy!.id);
    expect(versions?.map((v) => v.status)).toEqual(["draft"]);
  });
});
