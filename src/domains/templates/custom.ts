import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { parseFormSchema } from "@/domains/forms/schema/validate";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { previewFromSchema, type FormPreview } from "@/domains/forms/queries";
import { NON_ANSWERABLE_TYPES } from "@/domains/forms/schema/question-types";
import { withFreshIds } from "@/domains/forms/fresh-ids";

type Client = SupabaseClient<Database>;

/**
 * Custom form templates (F-61): a workspace's own forms, saved as
 * templates to start new forms from. Only the schema is kept — questions,
 * logic, design, languages, variants. Responses, integrations, webhooks,
 * lookups, payment settings and keys live in their own tables and are
 * never copied. Row-level security decides who sees and changes what
 * (migration 62); these functions run as the signed-in member.
 */

export const TEMPLATE_VISIBILITIES = ["private", "workspace"] as const;
export type TemplateVisibility = (typeof TEMPLATE_VISIBILITIES)[number];

export type WorkspaceTemplateCard = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  visibility: TemplateVisibility;
  createdBy: string;
  createdByName: string | null;
  /** Whether the signed-in member made it (and so may share or rename it). */
  mine: boolean;
  createdAt: string;
  preview: FormPreview;
  questionCount: number;
};

export class TemplateError extends Error {}

const clean = (s: string | null | undefined, max: number) =>
  (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** A form's draft as a template. The draft is read as the member, so
 * a form they can't see can't be saved. */
export async function saveFormAsTemplate(
  supabase: Client,
  input: {
    workspaceId: string;
    userId: string;
    schema: FormSchemaV1;
    sourceFormId: string;
    title: string;
    description?: string | null;
    category?: string | null;
    visibility: TemplateVisibility;
  },
): Promise<{ id: string }> {
  const title = clean(input.title, 120);
  if (!title) throw new TemplateError("Give the template a name.");
  const schema = parseFormSchema(input.schema);
  const { data, error } = await supabase
    .from("workspace_templates")
    .insert({
      workspace_id: input.workspaceId,
      created_by: input.userId,
      title,
      description: clean(input.description, 500) || null,
      category: clean(input.category, 40) || "Custom",
      visibility: input.visibility,
      schema: schema as unknown as Json,
      source_form_id: input.sourceFormId,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "42501") {
      throw new TemplateError("Only editors and up can save templates.");
    }
    throw error;
  }
  return data;
}

export async function listWorkspaceTemplates(
  supabase: Client,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceTemplateCard[]> {
  const { data, error } = await supabase
    .from("workspace_templates")
    .select(
      "id, title, description, category, visibility, created_by, created_at, schema, profiles!workspace_templates_created_by_fkey(full_name, email)",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []).map((row) => {
    const questions =
      (row.schema as { questions?: { type?: string }[] } | null)?.questions ?? [];
    const profile = row.profiles as {
      full_name: string | null;
      email: string | null;
    } | null;
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category,
      visibility: row.visibility as TemplateVisibility,
      createdBy: row.created_by,
      createdByName: profile?.full_name || profile?.email || null,
      mine: row.created_by === userId,
      createdAt: row.created_at,
      preview: previewFromSchema(row.schema),
      questionCount: questions.filter((q) => !NON_ANSWERABLE_TYPES.has(q.type ?? ""))
        .length,
    };
  });
}

/** The schema for a new form from a template: checked again, with fresh
 * ids (so it shares none with the form it was saved from) and the
 * template's name as its title. */
export async function schemaFromWorkspaceTemplate(
  supabase: Client,
  workspaceId: string,
  templateId: string,
): Promise<{ title: string; schema: FormSchemaV1 } | null> {
  const { data, error } = await supabase
    .from("workspace_templates")
    .select("title, schema")
    .eq("id", templateId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { schema } = withFreshIds(parseFormSchema(data.schema));
  return {
    title: data.title,
    schema: { ...schema, meta: { ...schema.meta, title: data.title } },
  };
}

export async function updateWorkspaceTemplate(
  supabase: Client,
  workspaceId: string,
  templateId: string,
  patch: { title?: string; visibility?: TemplateVisibility; category?: string },
): Promise<boolean> {
  const update: Database["public"]["Tables"]["workspace_templates"]["Update"] = {};
  if (patch.title !== undefined) {
    const title = clean(patch.title, 120);
    if (!title) throw new TemplateError("Give the template a name.");
    update.title = title;
  }
  if (patch.visibility) update.visibility = patch.visibility;
  if (patch.category !== undefined)
    update.category = clean(patch.category, 40) || "Custom";
  const { data, error } = await supabase
    .from("workspace_templates")
    .update(update)
    .eq("id", templateId)
    .eq("workspace_id", workspaceId)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function deleteWorkspaceTemplate(
  supabase: Client,
  workspaceId: string,
  templateId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("workspace_templates")
    .delete()
    .eq("id", templateId)
    .eq("workspace_id", workspaceId)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** A private copy of a template the member can see, theirs to change
 * (F-61: manage and duplicate). Same snapshot; nothing else copied. */
export async function duplicateWorkspaceTemplate(
  supabase: Client,
  input: { workspaceId: string; userId: string; templateId: string },
): Promise<{ id: string } | null> {
  const { data: source, error } = await supabase
    .from("workspace_templates")
    .select("title, description, category, schema")
    .eq("id", input.templateId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (error) throw error;
  if (!source) return null;
  const { data, error: insertError } = await supabase
    .from("workspace_templates")
    .insert({
      workspace_id: input.workspaceId,
      created_by: input.userId,
      title: `${source.title} (copy)`.slice(0, 120),
      description: source.description,
      category: source.category,
      visibility: "private",
      schema: source.schema,
    })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "42501") {
      throw new TemplateError("Only editors and up can save templates.");
    }
    throw insertError;
  }
  return data;
}
