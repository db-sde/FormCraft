"use server";

import { saveDraftSchema, StaleDraftError, FormSchemaError } from "@/domains/forms";
import type { FormSchemaV1 } from "@/domains/forms";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";

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
