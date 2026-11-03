"use server";

import { revalidatePath } from "next/cache";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { canEdit } from "@/domains/workspaces";
import { hasPermission } from "@/domains/workspaces/permissions";
import {
  addComment,
  isReviewStatus,
  MAX_COMMENT_LENGTH,
  replayAttempt,
  responseInForm,
  setAssignee,
  setReviewStatus,
  type ResponseComment,
} from "@/domains/responses/records";
import { dispatchDueDeliveries } from "@/domains/webhooks";
import { dispatchDueSheetsSyncs } from "@/domains/sheets";
import { hitRateLimit } from "@/domains/abuse/shared-rate-limit";
import { logResponseEvent } from "@/domains/responses/timeline";
import "@/domains/connectors/registry";
import { dispatchConnectorJobs, replayJob } from "@/domains/connectors/framework";

type Result = { ok: true } | { ok: false; message: string };

const NOT_ALLOWED = "You don't have permission to change this response.";

/** Editors and up who can see responses, on a response of this form in
 * their workspace. */
async function authorize(formId: string, responseId: string) {
  const { supabase, workspace, user } = await getCurrentWorkspace();
  if (!canEdit(workspace.role)) return null;
  if (!(await hasPermission(supabase, workspace.id, "view_responses"))) return null;
  if (!(await responseInForm(supabase, workspace.id, formId, responseId))) return null;
  return { supabase, workspace, user };
}

function refresh(formId: string, responseId: string) {
  revalidatePath(`/forms/${formId}/responses`);
  revalidatePath(`/forms/${formId}/responses/${responseId}`);
}

export async function setReviewStatusAction(
  formId: string,
  responseId: string,
  status: string,
): Promise<Result> {
  if (!isReviewStatus(status)) return { ok: false, message: "Pick a status." };
  const auth = await authorize(formId, responseId);
  if (!auth) return { ok: false, message: NOT_ALLOWED };
  const ok = await setReviewStatus(createAdminClient(), {
    responseId,
    status,
    actorId: auth.user.id,
  });
  if (!ok) return { ok: false, message: "Couldn't change the status. Please try again." };
  refresh(formId, responseId);
  return { ok: true };
}

export async function setAssigneeAction(
  formId: string,
  responseId: string,
  assigneeId: string | null,
): Promise<Result> {
  const auth = await authorize(formId, responseId);
  if (!auth) return { ok: false, message: NOT_ALLOWED };
  const ok = await setAssignee(createAdminClient(), {
    workspaceId: auth.workspace.id,
    responseId,
    assigneeId: assigneeId || null,
    actorId: auth.user.id,
  });
  if (!ok)
    return { ok: false, message: "Couldn't assign it. Pick someone on this team." };
  refresh(formId, responseId);
  return { ok: true };
}

export async function addCommentAction(
  formId: string,
  responseId: string,
  body: string,
): Promise<{ ok: true; comment: ResponseComment } | { ok: false; message: string }> {
  const text = body.trim();
  if (!text) return { ok: false, message: "Write a comment first." };
  if (text.length > MAX_COMMENT_LENGTH) {
    return { ok: false, message: `Keep it under ${MAX_COMMENT_LENGTH} characters.` };
  }
  const auth = await authorize(formId, responseId);
  if (!auth) return { ok: false, message: NOT_ALLOWED };
  const admin = createAdminClient();
  if (!(await hitRateLimit(admin, `comment:${auth.user.id}`, 30, 60_000)).allowed) {
    return { ok: false, message: "Too many comments at once. Wait a minute." };
  }
  const comment = await addComment(admin, {
    responseId,
    body: text,
    authorId: auth.user.id,
  });
  if (!comment)
    return { ok: false, message: "Couldn't save the comment. Please try again." };
  refresh(formId, responseId);
  return { ok: true, comment };
}

/** Sends a failed webhook or Sheets attempt again. Needs the right to
 * manage integrations as well. */
export async function replayAttemptAction(
  formId: string,
  responseId: string,
  target: string,
  attemptId: string,
): Promise<Result> {
  if (target !== "webhook" && target !== "sheets" && target !== "connector") {
    return { ok: false, message: "Only webhook and Sheets attempts can be sent again." };
  }
  const auth = await authorize(formId, responseId);
  if (
    !auth ||
    !(await hasPermission(auth.supabase, auth.workspace.id, "manage_integrations"))
  ) {
    return { ok: false, message: "You don't have permission to resend integrations." };
  }
  const admin = createAdminClient();
  if (target === "connector") {
    // A connector job of this response (or of its booking): the same
    // row and idempotency key go back in the queue.
    const { data: job } = await admin
      .from("connector_jobs")
      .select("id, response_id, bookings(response_id)")
      .eq("id", attemptId)
      .maybeSingle();
    const owner =
      job?.response_id ??
      (job?.bookings as { response_id: string | null } | null)?.response_id;
    if (!job || owner !== responseId)
      return { ok: false, message: "That attempt isn't this response's." };
    if (!(await replayJob(admin, attemptId)))
      return {
        ok: false,
        message:
          "That attempt can't be sent again. If the app was disconnected, reconnect it first.",
      };
    await logResponseEvent(admin, {
      responseId,
      kind: "replay",
      actorId: auth.user.id,
      detail: { target: "connector", attempt: attemptId },
    });
    await dispatchConnectorJobs(admin, { responseId }).catch(() => null);
    refresh(formId, responseId);
    return { ok: true };
  }
  const queued = await replayAttempt(admin, {
    target,
    id: attemptId,
    responseId,
    actorId: auth.user.id,
  });
  if (!queued)
    return { ok: false, message: "That attempt isn't waiting to be sent again." };
  try {
    if (target === "webhook") await dispatchDueDeliveries(admin, { responseId });
    else await dispatchDueSheetsSyncs(admin, { responseId });
  } catch {
    // Still queued: the scheduled sweep sends it.
  }
  refresh(formId, responseId);
  return { ok: true };
}
