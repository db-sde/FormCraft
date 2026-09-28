import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { listTemplates, getTemplateById } from "@/domains/templates";
import { createFormWithDraft } from "@/domains/forms";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";

/**
 * Exercises the templates read path and template-seeded form creation
 * against a real local Postgres instance. Requires `supabase start` —
 * see docs/testing.md.
 */

function admin(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set for integration tests",
    );
  }
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

const templateSchema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Integration Test Template", description: "A template for tests." },
  theme: {
    primaryColor: "#0f172a",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end_default", title: "Thanks!", isDefault: true }],
  questions: [
    {
      id: "q_welcome",
      type: "welcome_screen",
      order: 0,
      label: "Welcome",
      required: false,
      settings: { buttonLabel: "Start" },
    },
    {
      id: "q_rating",
      type: "rating",
      order: 1,
      label: "How would you rate us?",
      required: true,
      settings: { scale: 5 },
    },
  ],
  logic: [],
};

describe("templates (integration)", () => {
  const supabase = admin();
  let templateId: string;
  let userId: string;
  let workspaceId: string;
  const testRunId = crypto.randomUUID().slice(0, 8);

  beforeAll(async () => {
    const { data: template, error: templateError } = await supabase
      .from("templates")
      .insert({
        title: `Integration Test Template ${testRunId}`,
        category: "Testing",
        description: "A template for tests.",
        schema: templateSchema as unknown as Json,
        sort_order: 9999,
      })
      .select("id")
      .single();
    if (templateError) throw templateError;
    templateId = template.id;

    const email = `templates-test-${testRunId}@example.com`;
    const { data: userData, error: userError } = await supabase.auth.admin.createUser({
      email,
      password: crypto.randomUUID(),
      email_confirm: true,
    });
    if (userError) throw userError;
    userId = userData.user.id;

    const { data: workspace, error: workspaceError } = await supabase
      .from("workspaces")
      .insert({
        name: "Templates Test Workspace",
        slug: `ttw-${testRunId}`,
        owner_id: userId,
      })
      .select("id")
      .single();
    if (workspaceError) throw workspaceError;
    workspaceId = workspace.id;

    await supabase
      .from("workspace_members")
      .insert({ workspace_id: workspaceId, user_id: userId, role: "owner" });
  });

  afterAll(async () => {
    if (templateId) await supabase.from("templates").delete().eq("id", templateId);
    if (workspaceId) await supabase.from("workspaces").delete().eq("id", workspaceId);
    if (userId) await supabase.auth.admin.deleteUser(userId);
  });

  it("lists templates including the seeded one", async () => {
    const templates = await listTemplates(supabase);
    const found = templates.find((tpl) => tpl.id === templateId);
    expect(found).toBeDefined();
    expect(found?.category).toBe("Testing");
  });

  it("fetches a template with its parsed, valid schema", async () => {
    const template = await getTemplateById(supabase, templateId);
    expect(template).not.toBeNull();
    expect(template?.schema.questions).toHaveLength(2);
    expect(template?.schema.questions[1]?.type).toBe("rating");
  });

  it("returns null for a non-existent template id", async () => {
    const template = await getTemplateById(supabase, crypto.randomUUID());
    expect(template).toBeNull();
  });

  it("creates a form whose draft is the template's schema, not the blank starter", async () => {
    const template = await getTemplateById(supabase, templateId);
    expect(template).not.toBeNull();

    const { id: formId } = await createFormWithDraft(
      supabase,
      workspaceId,
      userId,
      template!.schema.meta.title,
      template!.schema,
    );

    const { data: draft } = await supabase
      .from("form_versions")
      .select("schema")
      .eq("form_id", formId)
      .eq("status", "draft")
      .single();

    const schema = draft?.schema as unknown as FormSchemaV1;
    expect(schema.questions).toHaveLength(2);
    expect(schema.questions[1]?.type).toBe("rating");

    await supabase.from("forms").delete().eq("id", formId);
  });
});
