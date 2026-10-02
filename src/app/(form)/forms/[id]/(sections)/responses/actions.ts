"use server";

import { revalidatePath } from "next/cache";
import { deleteResponse } from "@/domains/responses";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Authorization is RLS: the DELETE only matches a row whose parent
 * form belongs to a workspace the caller can edit (see "responses:
 * editors can delete via form", migration 28) — an id for
 * someone else's response simply deletes zero rows rather than
 * erroring, same pattern used by the draft-save action.
 */
export async function deleteResponseAction(
  formId: string,
  responseId: string,
): Promise<{ ok: boolean }> {
  const { supabase } = await getCurrentWorkspace();

  try {
    const deleted = await deleteResponse(supabase, responseId, createAdminClient());
    if (!deleted) return { ok: false };
    revalidatePath(`/forms/${formId}/responses`);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
