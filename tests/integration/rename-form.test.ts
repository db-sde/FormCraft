import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { createFormWithDraft, renameForm } from "@/domains/forms";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";

// QA FC-13: a never-published form's link follows its name.
const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const runId = crypto.randomUUID().slice(0, 8);

const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Untitled form" },
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
    email: `rename-${runId}@example.com`,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  if (error) throw error;
  userId = user.user.id;
  const { data: workspace } = await admin
    .from("workspaces")
    .insert({ name: "Rename", slug: `rename-${runId}`, owner_id: userId })
    .select("id")
    .single();
  workspaceId = workspace!.id;
}, 30_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", workspaceId);
  await admin.auth.admin.deleteUser(userId);
});

async function newForm() {
  const { id } = await createFormWithDraft(
    admin,
    workspaceId,
    userId,
    "Untitled form",
    schema,
  );
  return id;
}

const slugOf = async (id: string) =>
  (await admin.from("forms").select("slug").eq("id", id).single()).data!.slug;

describe("renaming a form", () => {
  it("gives a never-published form a link made from its new name", async () => {
    const id = await newForm();
    expect(await slugOf(id)).toMatch(/^untitled-form-[a-z0-9]{6}$/);
    const { slug } = await renameForm(admin, id, workspaceId, "QA retest form");
    expect(slug).toMatch(/^qa-retest-form-[a-z0-9]{6}$/);
    expect(await slugOf(id)).toBe(slug);
  });

  it("keeps the link of a form that has been published", async () => {
    const id = await newForm();
    const before = await slugOf(id);
    const { error } = await admin.rpc("publish_form_version", {
      target_form_id: id,
      compiled_schema: schema as unknown as Json,
    });
    expect(error).toBeNull();
    const { slug } = await renameForm(admin, id, workspaceId, "Renamed after launch");
    expect(slug).toBe(before);
    expect(await slugOf(id)).toBe(before);
  });

  it("keeps a link someone chose themselves", async () => {
    const id = await newForm();
    const chosen = `my-own-link-${runId}`;
    await admin.from("forms").update({ slug: chosen }).eq("id", id);
    const { slug } = await renameForm(admin, id, workspaceId, "Another name");
    expect(slug).toBe(chosen);
  });
});
