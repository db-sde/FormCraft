"use server";

import { revalidatePath } from "next/cache";
import { deleteResponse } from "@/domains/responses";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";

/**
 * Authorization is RLS: the DELETE only matches a row whose parent
 * form belongs to a workspace the caller is a member of (see
 * "responses: members can delete via form" policy) — an id for
 * someone else's response simply deletes zero rows rather than
 * erroring, same pattern used by the draft-save action.
 */
export async function deleteResponseAction(
  formId: string,
  responseId: string,
): Promise<{ ok: boolean }> {
  const { supabase } = await getCurrentWorkspace();

  try {
    await deleteResponse(supabase, responseId);
    revalidatePath(`/forms/${formId}/responses`);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
