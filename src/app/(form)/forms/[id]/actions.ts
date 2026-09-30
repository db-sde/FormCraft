"use server";

import { revalidatePath } from "next/cache";
import {
  saveDraftSchema,
  publishForm,
  unpublishForm,
  renameForm,
  StaleDraftError,
  FormSchemaError,
  MAX_FORM_TITLE_LENGTH,
} from "@/domains/forms";
import type { FormSchemaV1 } from "@/domains/forms";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";

export async function renameFormAction(
  formId: string,
  title: string,
): Promise<{ ok: true; title: string } | { ok: false; message: string }> {
  const trimmed = title.trim();
  if (!trimmed) return { ok: false, message: "Give your form a name." };
  if (trimmed.length > MAX_FORM_TITLE_LENGTH) {
    return {
      ok: false,
      message: `Keep the name under ${MAX_FORM_TITLE_LENGTH} characters.`,
    };
  }
  const { supabase, workspace } = await getCurrentWorkspace();
  try {
    await renameForm(supabase, formId, workspace.id, trimmed);
    revalidatePath("/dashboard");
    return { ok: true, title: trimmed };
  } catch {
    return { ok: false, message: "Couldn't rename the form. Please try again." };
  }
}

export type SaveDraftResult =
  | { ok: true; revision: number }
  | { ok: false; code: "stale" | "invalid" | "unknown"; message: string };

/**
 * Draft autosave. Authorization comes from RLS on the update itself
 * (the caller's session-scoped Supabase client can only match a
 * form_versions row that belongs to a form in one of their
 * workspaces — see the "form_versions: members can update via form"
 * policy) rather than a manual ownership check here: an unauthorized
 * draftVersionId simply matches zero rows, which saveDraftSchema
 * reports the same way it reports a genuine stale write.
 */
export async function saveDraftAction(
  draftVersionId: string,
  expectedRevision: number,
  schema: FormSchemaV1,
): Promise<SaveDraftResult> {
  const { supabase } = await getCurrentWorkspace();

  try {
    const { revision } = await saveDraftSchema(
      supabase,
      draftVersionId,
      expectedRevision,
      schema,
    );
    return { ok: true, revision };
  } catch (error) {
    if (error instanceof StaleDraftError) {
      return { ok: false, code: "stale", message: error.message };
    }
    if (error instanceof FormSchemaError) {
      return { ok: false, code: "invalid", message: error.message };
    }
    return { ok: false, code: "unknown", message: "Failed to save. Please try again." };
  }
}

export type PublishResult =
  | { ok: true; publishedVersionNumber: number }
  | { ok: false; code: "invalid" | "unknown"; message: string };

/**
 * Publishes the current draft (see domains/forms/queries.ts
 * publishForm — it re-validates and runs the full publication
 * compiler, so a draft with e.g. an inescapable logic loop is
 * rejected here with a specific, actionable error rather than ever
 * reaching the public runtime).
 */
export async function publishAction(formId: string): Promise<PublishResult> {
  const { supabase } = await getCurrentWorkspace();

  try {
    const result = await publishForm(supabase, formId);
    revalidatePath(`/forms/${formId}`);
    return { ok: true, publishedVersionNumber: result.versionNumber };
  } catch (error) {
    if (error instanceof FormSchemaError) {
      return { ok: false, code: "invalid", message: error.message };
    }
    return {
      ok: false,
      code: "unknown",
      message: "Failed to publish. Please try again.",
    };
  }
}

export async function unpublishAction(
  formId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { supabase } = await getCurrentWorkspace();

  try {
    await unpublishForm(supabase, formId);
    revalidatePath(`/forms/${formId}`);
    return { ok: true };
  } catch {
    return { ok: false, message: "Failed to unpublish. Please try again." };
  }
}
