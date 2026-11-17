"use server";

import { revalidatePath } from "next/cache";
import { deleteResponse } from "@/domains/responses";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/domains/audit/record";

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
  const { supabase, user, workspace } = await getCurrentWorkspace();

  try {
    const deleted = await deleteResponse(supabase, responseId, createAdminClient());
    // Recorded either way (foundations §4): a refused delete is worth
    // knowing about too.
    await recordAudit({
      workspaceId: workspace.id,
      actorId: user.id,
      action: "response.deleted",
      target: { type: "response", id: responseId },
      metadata: { formId },
      outcome: deleted ? "succeeded" : "denied",
    });
    if (!deleted) return { ok: false };
    revalidatePath(`/forms/${formId}/responses`);
    return { ok: true };
  } catch {
    await recordAudit({
      workspaceId: workspace.id,
      actorId: user.id,
      action: "response.deleted",
      target: { type: "response", id: responseId },
      metadata: { formId },
      outcome: "failed",
    });
    return { ok: false };
  }
}
