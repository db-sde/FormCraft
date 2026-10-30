import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { logResponseEvent } from "./timeline";
import { MAX_COMMENT_LENGTH, type ReviewStatus, type ResponseComment } from "./review";

export * from "./review";

type Client = SupabaseClient<Database>;

/**
 * The records view (master spec F-03): each response gets a review
 * status and an assignee, and the team keeps private comments on it.
 * Product owner's choices (2026-10-30): the statuses are New, In progress
 * and Done; editors and up change them (viewers read). Every change is
 * written to the response's timeline with who made it.
 *
 * Comments are internal: no respondent-facing route reads them, and the
 * CSV/Excel export doesn't include them.
 *
 * Callers check the caller first (`canChangeRecord`), then write with
 * the service-role client.
 */

/** Whether the response belongs to this form in this workspace — read as
 * the caller, so RLS refuses what they can't see. */
export async function responseInForm(
  supabase: Client,
  workspaceId: string,
  formId: string,
  responseId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("responses")
    .select("id, forms!inner(workspace_id)")
    .eq("id", responseId)
    .eq("form_id", formId)
    .eq("forms.workspace_id", workspaceId)
    .maybeSingle();
  return Boolean(data);
}

export async function setReviewStatus(
  admin: Client,
  input: { responseId: string; status: ReviewStatus; actorId: string },
): Promise<boolean> {
  const { data: before } = await admin
    .from("responses")
    .select("review_status")
    .eq("id", input.responseId)
    .maybeSingle();
  if (!before) return false;
  if (before.review_status === input.status) return true;
  const { error } = await admin
    .from("responses")
    .update({ review_status: input.status })
    .eq("id", input.responseId);
  if (error) return false;
  await logResponseEvent(admin, {
    responseId: input.responseId,
    kind: "status_changed",
    actorId: input.actorId,
    detail: { from: before.review_status, to: input.status },
  });
  return true;
}

/** People a response can be assigned to: workspace members who can see
 * responses. */
export async function assignableMembers(
  admin: Client,
  workspaceId: string,
): Promise<{ id: string; name: string }[]> {
  const { data } = await admin
    .from("workspace_members")
    .select("user_id, role, permissions, profiles(full_name, email)")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  return (data ?? [])
    .filter((m) => {
      const overrides = (m.permissions ?? {}) as Record<string, unknown>;
      if (m.role === "owner" || m.role === "admin") return true;
      return overrides.view_responses !== false;
    })
    .map((m) => {
      const p = m.profiles as { full_name: string | null; email: string } | null;
      return { id: m.user_id, name: p?.full_name || p?.email || "Teammate" };
    });
}

export async function setAssignee(
  admin: Client,
  input: {
    workspaceId: string;
    responseId: string;
    assigneeId: string | null;
    actorId: string;
  },
): Promise<boolean> {
  let toName: string | null = null;
  if (input.assigneeId) {
    const member = (await assignableMembers(admin, input.workspaceId)).find(
      (m) => m.id === input.assigneeId,
    );
    if (!member) return false;
    toName = member.name;
  }
  const { data: before } = await admin
    .from("responses")
    .select("assignee_id")
    .eq("id", input.responseId)
    .maybeSingle();
  if (!before) return false;
  if (before.assignee_id === input.assigneeId) return true;
  const { error } = await admin
    .from("responses")
    .update({ assignee_id: input.assigneeId })
    .eq("id", input.responseId);
  if (error) return false;
  await logResponseEvent(admin, {
    responseId: input.responseId,
    kind: "assigned",
    actorId: input.actorId,
    detail: { to: input.assigneeId, toName },
  });
  return true;
}

export async function addComment(
  admin: Client,
  input: { responseId: string; body: string; authorId: string },
): Promise<ResponseComment | null> {
  const body = input.body.trim();
  if (!body || body.length > MAX_COMMENT_LENGTH) return null;
  const { data, error } = await admin
    .from("response_comments")
    .insert({ response_id: input.responseId, author_id: input.authorId, body })
    .select("id, body, author_id, created_at, profiles(full_name, email)")
    .single();
  if (error || !data) return null;
  await logResponseEvent(admin, {
    responseId: input.responseId,
    kind: "commented",
    actorId: input.authorId,
  });
  const p = data.profiles as { full_name: string | null; email: string } | null;
  return {
    id: data.id,
    body: data.body,
    authorId: data.author_id,
    author: p?.full_name || p?.email || null,
    createdAt: data.created_at,
  };
}

/** A response's comments, oldest first, read as the caller (RLS). */
export async function listComments(
  supabase: Client,
  responseId: string,
): Promise<ResponseComment[]> {
  const { data } = await supabase
    .from("response_comments")
    .select("id, body, author_id, created_at, profiles(full_name, email)")
    .eq("response_id", responseId)
    .order("created_at");
  return (data ?? []).map((c) => {
    const p = c.profiles as { full_name: string | null; email: string } | null;
    return {
      id: c.id,
      body: c.body,
      authorId: c.author_id,
      author: p?.full_name || p?.email || null,
      createdAt: c.created_at,
    };
  });
}

/**
 * Sends a failed webhook or Sheets attempt again (F-31 "authorized manual
 * replay"). Only a failed or given-up attempt for this response, and only
 * those two kinds: a payment is never replayed (the respondent pays
 * through Stripe, which owns its own retries), and emails aren't either.
 *
 * The attempt goes back in the queue as the same row, so a webhook keeps
 * its event id — consumers that dedupe on it see a repeat, not a new
 * submission. Returns false when there was nothing to send again.
 */
export async function replayAttempt(
  admin: Client,
  input: {
    target: "webhook" | "sheets";
    id: string;
    responseId: string;
    actorId: string;
  },
): Promise<boolean> {
  const reset = {
    status: "pending" as const,
    attempt_count: 0,
    last_error: null,
    next_attempt_at: new Date().toISOString(),
  };
  let integration: string | null = null;
  if (input.target === "webhook") {
    const { data } = await admin
      .from("webhook_deliveries")
      .update(reset)
      .eq("id", input.id)
      .eq("response_id", input.responseId)
      .in("status", ["failed", "exhausted"])
      .select("id, webhook_endpoints(kind)");
    if (!data?.length) return false;
    integration = (data[0].webhook_endpoints as { kind: string } | null)?.kind ?? null;
  } else {
    const { data } = await admin
      .from("sheets_sync_log")
      .update(reset)
      .eq("id", input.id)
      .eq("response_id", input.responseId)
      .in("status", ["failed", "exhausted"])
      .select("id");
    if (!data?.length) return false;
  }
  await logResponseEvent(admin, {
    responseId: input.responseId,
    kind: "replay",
    actorId: input.actorId,
    detail: { target: input.target, integration, attempt: input.id },
  });
  return true;
}
