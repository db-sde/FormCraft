import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { customAlphabet, nanoid } from "nanoid";
import { slugify } from "@/domains/workspaces";
import {
  parseFormSchema,
  validateForPublish,
  validateSemantics,
} from "./schema/validate";
import { compileFormSchema, type CompiledFormV1 } from "./schema/compile";
import type { FormSchemaV1 } from "./schema/v1";

type Client = SupabaseClient<Database>;

/** 6 chars of [a-z0-9] ≈ 2.2 billion combinations per title prefix. */
const slugSuffix = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 6);

/** form_versions.schema is validated end-to-end by FormSchemaV1 before
 * it's ever written (see docs/form-schema.md); this cast is only about
 * `logic[].value` being `z.unknown()` at the type level (it holds a
 * respondent-comparable answer value, which is always JSON-serializable
 * by construction, just not provably so to the type checker). */
function toJson(schema: FormSchemaV1): Json {
  return schema as unknown as Json;
}

/** Draft: never published. Live: a published version is serving.
 * Unpublished: it was live, then taken down (versions archived). */
export type PublishState = "draft" | "live" | "unpublished";

export function publishStateFrom(versionStatuses: string[]): PublishState {
  if (versionStatuses.includes("published")) return "live";
  return versionStatuses.includes("archived") ? "unpublished" : "draft";
}

export type FormListItem = {
  id: string;
  title: string;
  slug: string;
  updatedAt: string;
  hasPublishedVersion: boolean;
  publishState: PublishState;
  /** Submitted responses. */
  responseCount: number;
  /** Respondents who answered something but never submitted. */
  incompleteCount: number;
  createdAt: string;
  /** Enough of the draft to draw the dashboard card's preview. */
  preview: FormPreview;
};

/** The first real question of a form, drawn in the form's own theme on
 * dashboard and template cards. */
export type FormPreview = {
  theme: FormSchemaV1["theme"];
  question: string;
  /** Up to four answer chips (options, scale numbers, Yes/No…). */
  chips: string[];
};

const DEFAULT_PREVIEW_THEME: FormSchemaV1["theme"] = {
  primaryColor: "#0f172a",
  backgroundColor: "#ffffff",
  fontFamily: "inter",
  buttonStyle: "rounded",
};

/** Builds a card preview from a schema without trusting its shape —
 * a malformed draft still gets a sensible card. */
export function previewFromSchema(raw: unknown): FormPreview {
  const schema = (raw ?? {}) as Partial<FormSchemaV1>;
  const theme = { ...DEFAULT_PREVIEW_THEME, ...(schema.theme ?? {}) };
  const questions = [...(schema.questions ?? [])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  const first =
    questions.find((q) => q.type !== "welcome_screen" && q.type !== "statement") ??
    questions[0];
  if (!first)
    return { theme, question: schema.meta?.title ?? "Untitled form", chips: [] };

  let chips: string[] = [];
  const settings = (first.settings ?? {}) as Record<string, unknown>;
  switch (first.type) {
    case "single_select":
    case "multi_select":
    case "dropdown":
      chips = ((settings.options as { label?: string }[] | undefined) ?? [])
        .map((o) => o.label ?? "")
        .filter(Boolean);
      break;
    case "yes_no":
      chips = [
        (settings.yesLabel as string | undefined) || "Yes",
        (settings.noLabel as string | undefined) || "No",
      ];
      break;
    case "rating":
      chips = Array.from({ length: Math.min(Number(settings.scale) || 5, 5) }, (_, i) =>
        String(i + 1),
      );
      break;
    case "opinion_scale": {
      const max = Number(settings.max ?? 10);
      chips = [max - 3, max - 2, max - 1, max].filter((n) => n >= 0).map(String);
      break;
    }
    case "file_upload":
      chips = ["Upload"];
      break;
    case "contact_info":
      chips = ["Name", "Email"];
      break;
  }
  return {
    theme,
    question: first.label || "Untitled question",
    chips: chips.slice(0, 4),
  };
}

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
        id: `q_${nanoid(10)}`,
        type: "long_text",
        order: 1,
        label: "What can we help you with?",
        required: true,
        settings: {},
      },
      // Lead capture sits before the last question: once the respondent
      // moves past it their details are saved, even if they never finish.
      {
        id: `q_${nanoid(10)}`,
        type: "contact_info",
        order: 2,
        label: "Where can we reach you?",
        description: "We'll only use this to get back to you.",
        required: true,
        settings: {
          fields: ["name", "email", "phone"],
          requiredFields: ["name", "email"],
        },
      },
      {
        id: `q_${nanoid(10)}`,
        type: "long_text",
        order: 3,
        label: "Anything else we should know?",
        required: false,
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
    .select(
      "id, title, slug, updated_at, created_at, form_versions(status), draft:form_versions(schema), completed:responses(count), incomplete:responses(count)",
    )
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    // These filter the embedded rows, not the forms.
    .eq("draft.status", "draft")
    .eq("completed.status", "completed")
    .eq("incomplete.status", "partial")
    .order("updated_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((form) => ({
    id: form.id,
    title: form.title,
    slug: form.slug,
    updatedAt: form.updated_at,
    hasPublishedVersion: (form.form_versions ?? []).some((v) => v.status === "published"),
    publishState: publishStateFrom((form.form_versions ?? []).map((v) => v.status)),
    responseCount: form.completed?.[0]?.count ?? 0,
    incompleteCount: form.incomplete?.[0]?.count ?? 0,
    createdAt: form.created_at,
    preview: previewFromSchema(form.draft?.[0]?.schema),
  }));
}

/**
 * Creates a form + its initial draft version. `initialSchema` defaults
 * to the blank starter schema; passing a template's schema instead
 * (see @/domains/templates) reuses this exact same slug-allocation and
 * insert logic rather than duplicating it — a template-created form is
 * just a form whose first draft didn't start blank.
 */
export async function createFormWithDraft(
  supabase: Client,
  workspaceId: string,
  userId: string,
  title: string,
  initialSchema?: FormSchemaV1,
): Promise<{ id: string }> {
  // Slugs are globally unique (the public URL is /f/<slug> with no
  // workspace in it), so a readable prefix alone can't work: counting
  // up "untitled-form", "-1", "-2"… collides across every customer who
  // ever leaves a form untitled and ran out after five. A random
  // suffix makes collisions vanishingly rare; the loop only covers
  // that rare case.
  const baseSlug = slugify(title).slice(0, 48) || "form";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = `${baseSlug}-${slugSuffix()}`;
    // One transaction: the form and its first draft exist together or
    // not at all (a failure can't leave a draft-less form behind).
    const { data: formId, error } = await supabase.rpc("create_form_with_draft", {
      p_workspace_id: workspaceId,
      p_title: title,
      p_slug: slug,
      p_schema: toJson(initialSchema ?? starterFormSchema(title)),
      p_created_by: userId,
    });

    if (error) {
      if (error.code === "23505") continue; // slug taken — try another suffix
      throw error;
    }
    return { id: formId };
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

export type PublishInfo = {
  slug: string;
  isPublished: boolean;
  publishedAt: string | null;
  publishedVersionNumber: number | null;
  /** The draft has edits respondents can't see until the next publish. */
  hasUnpublishedChanges: boolean;
};

export async function getPublishInfo(
  supabase: Client,
  formId: string,
): Promise<PublishInfo | null> {
  const { data: form, error: formError } = await supabase
    .from("forms")
    .select("slug")
    .eq("id", formId)
    .maybeSingle();
  if (formError) throw formError;
  if (!form) return null;

  const { data: versions, error: versionsError } = await supabase
    .from("form_versions")
    .select("status, schema, published_at, version_number")
    .eq("form_id", formId)
    .in("status", ["published", "draft"]);
  if (versionsError) throw versionsError;

  const published = versions?.find((v) => v.status === "published");
  const draft = versions?.find((v) => v.status === "draft");

  return {
    slug: form.slug,
    isPublished: Boolean(published),
    publishedAt: published?.published_at ?? null,
    publishedVersionNumber: published?.version_number ?? null,
    hasUnpublishedChanges:
      published !== undefined &&
      draft !== undefined &&
      !sameSchema(published.schema, draft.schema),
  };
}

/** Compares through parseFormSchema so storage details (jsonb key
 * order, defaults filled in vs. omitted) can't register as a change. */
function sameSchema(a: Json, b: Json): boolean {
  try {
    return JSON.stringify(parseFormSchema(a)) === JSON.stringify(parseFormSchema(b));
  } catch {
    return false;
  }
}

/**
 * Publishing pipeline: load the draft, run it through the full
 * validation chain (structural → semantic → publication compile — the
 * last stage is the strict one, checking reachability and inescapable
 * loops per docs/form-schema.md), then archive the current published
 * version and insert the new one atomically via the
 * publish_form_version RPC. The draft row is never touched — publish
 * only ever reads it.
 */
export type PublishResult = {
  compiled: CompiledFormV1;
  versionNumber: number;
  publishedAt: string;
};

export async function publishForm(
  supabase: Client,
  formId: string,
  /** Service-role client. Publishing isn't available to end users'
   * sessions (they could publish arbitrary JSON); the caller's own
   * client is only used to prove they can read this form's draft. */
  admin: Client,
): Promise<PublishResult> {
  const { data: draft, error: draftError } = await supabase
    .from("form_versions")
    .select("schema")
    .eq("form_id", formId)
    .eq("status", "draft")
    .single();
  if (draftError) throw draftError;

  const parsed = parseFormSchema(draft.schema);
  validateForPublish(parsed);
  const compiled = compileFormSchema(parsed);

  const { data, error } = await admin.rpc("publish_form_version", {
    target_form_id: formId,
    compiled_schema: toJson(compiled.schema),
  });
  if (error) throw error;
  if (!data) throw new Error("publish_form_version returned no row");

  return {
    compiled,
    versionNumber: data.version_number,
    publishedAt: data.published_at!,
  };
}

/** The schema respondents are currently being served, or null when the
 * form isn't live. */
export async function getPublishedSchema(
  supabase: Client,
  formId: string,
): Promise<FormSchemaV1 | null> {
  const { data, error } = await supabase
    .from("form_versions")
    .select("schema")
    .eq("form_id", formId)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw error;
  return data ? parseFormSchema(data.schema) : null;
}

/** Unpublish = archive the currently published version, no
 * replacement. The public runtime treats an unpublished form as
 * unavailable (no `published` row to read) rather than deleting
 * anything. */
export async function unpublishForm(supabase: Client, formId: string): Promise<void> {
  const { error } = await supabase.rpc("unpublish_form", { target_form_id: formId });
  if (error) throw error;
}

export const MAX_FORM_TITLE_LENGTH = 200;

/** Renames the form as creators see it on the dashboard. The slug (and
 * so any shared public link) deliberately never changes on rename. */
export async function renameForm(
  supabase: Client,
  formId: string,
  workspaceId: string,
  title: string,
): Promise<void> {
  const { error } = await supabase
    .from("forms")
    .update({ title })
    .eq("id", formId)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);
  if (error) throw error;
}

/** Copies a form's current *draft* into a brand-new, unpublished form,
 * along with how it treats unfinished responses (a copy of a form that
 * deliberately doesn't keep them shouldn't start keeping them).
 * Responses, integrations, and publish state are never copied. */
export async function duplicateForm(
  supabase: Client,
  formId: string,
  workspaceId: string,
  userId: string,
): Promise<{ id: string } | null> {
  const draft = await getDraftForEdit(supabase, formId, workspaceId);
  if (!draft) return null;
  const title = `${draft.formTitle} (copy)`.slice(0, MAX_FORM_TITLE_LENGTH);
  const settings = await getFormSettings(supabase, formId, workspaceId);
  const copy = await createFormWithDraft(supabase, workspaceId, userId, title, {
    ...draft.schema,
    meta: { ...draft.schema.meta, title },
  });
  if (copy && settings) {
    await updatePartialResponseSettings(supabase, copy.id, workspaceId, {
      savePartialResponses: settings.savePartialResponses,
      partialRetentionDays: settings.partialRetentionDays,
    });
  }
  return copy;
}

/**
 * Soft delete: takes the form offline first (archiving its published
 * version, so the public link stops accepting responses immediately),
 * then hides it from the workspace. Responses are kept — deleted_at is
 * a tombstone, not a purge.
 */
export async function softDeleteForm(
  supabase: Client,
  formId: string,
  workspaceId: string,
): Promise<void> {
  const { data: form, error: formError } = await supabase
    .from("forms")
    .select("id")
    .eq("id", formId)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .maybeSingle();
  if (formError) throw formError;
  if (!form) return;

  await unpublishForm(supabase, formId);
  const { error } = await supabase
    .from("forms")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", formId);
  if (error) throw error;
}

export type PublicForm = {
  formId: string;
  formVersionId: string;
  compiled: CompiledFormV1;
  /** Creator setting: autosave answers from respondents who don't finish. */
  savePartialResponses: boolean;
};

export type FormSettings = {
  title: string;
  slug: string;
  savePartialResponses: boolean;
  /** Days after last activity before unfinished responses are deleted; null = keep. */
  partialRetentionDays: number | null;
};

export async function getFormSettings(
  supabase: Client,
  formId: string,
  workspaceId: string,
): Promise<FormSettings | null> {
  const { data, error } = await supabase
    .from("forms")
    .select("title, slug, save_partial_responses, partial_retention_days")
    .eq("id", formId)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data
    ? {
        title: data.title,
        slug: data.slug,
        savePartialResponses: data.save_partial_responses,
        partialRetentionDays: data.partial_retention_days,
      }
    : null;
}

export async function updatePartialResponseSettings(
  supabase: Client,
  formId: string,
  workspaceId: string,
  settings: { savePartialResponses: boolean; partialRetentionDays: number | null },
): Promise<void> {
  const { error } = await supabase
    .from("forms")
    .update({
      save_partial_responses: settings.savePartialResponses,
      partial_retention_days: settings.partialRetentionDays,
    })
    .eq("id", formId)
    .eq("workspace_id", workspaceId);
  if (error) throw error;
}

/**
 * What the public respondent runtime reads — the currently published
 * version for a slug, resolved via the anon-readable RLS policies
 * (see migration 2), never via a workspace-scoped query. Returns null
 * for a slug with no form, or a form with no published version (both
 * render the same "not available" state — see ARCHITECTURE.md).
 */
export async function getPublicFormBySlug(
  supabase: Client,
  slug: string,
): Promise<PublicForm | null> {
  const { data: form, error: formError } = await supabase
    .from("forms")
    .select("id, save_partial_responses")
    .eq("slug", slug)
    .is("deleted_at", null)
    .maybeSingle();
  if (formError) throw formError;
  if (!form) return null;

  const { data: version, error: versionError } = await supabase
    .from("form_versions")
    .select("id, schema")
    .eq("form_id", form.id)
    .eq("status", "published")
    .maybeSingle();
  if (versionError) throw versionError;
  if (!version) return null;

  const compiled = compileFormSchema(parseFormSchema(version.schema));
  return {
    formId: form.id,
    formVersionId: version.id,
    compiled,
    savePartialResponses: form.save_partial_responses,
  };
}

export class SlugTakenError extends Error {
  constructor() {
    super("slug already in use");
    this.name = "SlugTakenError";
  }
}

/** Changes a form's public link. Slugs are globally unique (the public
 * URL has no workspace in it), so a collision is reported, not retried. */
export async function updateFormSlug(
  supabase: Client,
  formId: string,
  workspaceId: string,
  slug: string,
): Promise<void> {
  const { error } = await supabase
    .from("forms")
    .update({ slug })
    .eq("id", formId)
    .eq("workspace_id", workspaceId);
  if (error) {
    if (error.code === "23505") throw new SlugTakenError();
    throw error;
  }
}
