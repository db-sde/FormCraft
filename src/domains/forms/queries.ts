import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { slugify } from "@/domains/workspaces";
import { parseFormSchema, validateSemantics } from "./schema/validate";
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

export type DraftForEdit = {
  formId: string;
  formTitle: string;
  draftVersionId: string;
  revision: number;
  schema: FormSchemaV1;
};

/** Loads a form's draft version for the builder. Returns null if the
 * form doesn't exist, isn't in this workspace, is soft-deleted, or (in
 * practice never, given the draft-uniqueness constraint) has no draft
 * row. RLS still scopes the underlying query — this is belt-and-braces
 * against a forged id in the route param. */
export async function getDraftForEdit(
  supabase: Client,
  formId: string,
  workspaceId: string,
): Promise<DraftForEdit | null> {
  const { data: form, error: formError } = await supabase
    .from("forms")
    .select("id, title")
    .eq("id", formId)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .maybeSingle();

  if (formError) throw formError;
  if (!form) return null;

  const { data: draft, error: draftError } = await supabase
    .from("form_versions")
    .select("id, schema, revision")
    .eq("form_id", form.id)
    .eq("status", "draft")
    .maybeSingle();

  if (draftError) throw draftError;
  if (!draft) return null;

  return {
    formId: form.id,
    formTitle: form.title,
    draftVersionId: draft.id,
    revision: draft.revision,
    schema: parseFormSchema(draft.schema),
  };
}

export class StaleDraftError extends Error {
  constructor() {
    super("the draft was changed elsewhere — reload before saving again");
    this.name = "StaleDraftError";
  }
}

/**
 * Compare-and-set draft save: only applies if `expectedRevision` still
 * matches what's stored (see migration 00000000000008 and
 * ARCHITECTURE.md's autosave section). Validates structurally +
 * semantically before writing — publish-time compilation (reachability/
 * cycle checks) happens separately, only at publish, so an in-progress
 * edit (e.g. a logic rule pointing at a question not yet added) can be
 * saved as a draft without blocking the creator.
 */
export async function saveDraftSchema(
  supabase: Client,
  draftVersionId: string,
  expectedRevision: number,
  schema: FormSchemaV1,
): Promise<{ revision: number }> {
  const parsed = parseFormSchema(schema);
  validateSemantics(parsed);

  const { data, error } = await supabase
    .from("form_versions")
    .update({ schema: toJson(parsed), revision: expectedRevision + 1 })
    .eq("id", draftVersionId)
    .eq("status", "draft")
    .eq("revision", expectedRevision)
    .select("revision")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new StaleDraftError();

  return { revision: data.revision };
}
