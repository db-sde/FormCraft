import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { slugify } from "@/domains/workspaces";
import type { FormSchemaV1 } from "./schema/v1";

type Client = SupabaseClient<Database>;

/** form_versions.schema is validated end-to-end by FormSchemaV1 before
 * it's ever written (see docs/form-schema.md); this cast is only about
 * `logic[].value` being `z.unknown()` at the type level (it holds a
 * respondent-comparable answer value, which is always JSON-serializable
 * by construction, just not provably so to the type checker). */
function toJson(schema: FormSchemaV1): Json {
  return schema as unknown as Json;
}

export type FormListItem = {
  id: string;
  title: string;
  slug: string;
  updatedAt: string;
  hasPublishedVersion: boolean;
  responseCount: number;
};

/** A minimal but valid draft schema for a brand-new form: a welcome
 * screen leads to one starter question, then the default ending. Kept
 * intentionally small — the builder is where a creator actually shapes
 * the form. */
export function starterFormSchema(title: string): FormSchemaV1 {
  return {
    schemaVersion: 1,
    meta: { title },
    theme: {
      primaryColor: "#0f172a",
      backgroundColor: "#ffffff",
      fontFamily: "inter",
      buttonStyle: "rounded",
    },
    endings: [{ id: "ending_default", title: "Thank you!", isDefault: true }],
    questions: [
      {
        id: "q_welcome",
        type: "welcome_screen",
        order: 0,
        label: title,
        description: "This will only take a minute.",
        required: false,
        settings: { buttonLabel: "Start" },
      },
      {
        id: "q_first",
        type: "short_text",
        order: 1,
        label: "What's your name?",
        required: true,
        settings: {},
      },
    ],
    logic: [],
  };
}

export async function listFormsForWorkspace(
  supabase: Client,
  workspaceId: string,
): Promise<FormListItem[]> {
  const { data, error } = await supabase
    .from("forms")
    .select("id, title, slug, updated_at, form_versions(status)")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((form) => ({
    id: form.id,
    title: form.title,
    slug: form.slug,
    updatedAt: form.updated_at,
    hasPublishedVersion: (form.form_versions ?? []).some((v) => v.status === "published"),
    // Response counts are fetched separately once the response
    // dashboard is built, to keep this query cheap for the list view.
    responseCount: 0,
  }));
}

export async function createFormWithDraft(
  supabase: Client,
  workspaceId: string,
  userId: string,
  title: string,
): Promise<{ id: string }> {
  const baseSlug = slugify(title);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt}`;
    const { data: form, error: formError } = await supabase
      .from("forms")
      .insert({ workspace_id: workspaceId, title, slug, created_by: userId })
      .select("id")
      .single();

    if (formError) {
      if (formError.message.includes("duplicate key")) continue;
      throw formError;
    }

    const { error: versionError } = await supabase.from("form_versions").insert({
      form_id: form.id,
      status: "draft",
      version_number: 1,
      schema: toJson(starterFormSchema(title)),
    });
    if (versionError) throw versionError;

    return { id: form.id };
  }

  throw new Error("failed to allocate a unique form slug after 5 attempts");
}
