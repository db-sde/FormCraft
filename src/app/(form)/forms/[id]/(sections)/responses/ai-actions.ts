"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiConfigured } from "@/domains/ai/config";
import {
  aiFailure,
  AI_NOT_CONFIGURED,
  AI_OUT_OF_CREDITS,
  type AiFailure,
} from "@/domains/ai/errors";
import { hitRateLimit } from "@/domains/abuse";
import { getWorkspacePlan } from "@/domains/billing";
import { canEdit } from "@/domains/workspaces";
import { hasPermission } from "@/domains/workspaces/permissions";
import {
  analyzeResponses,
  generateFormSummary,
  unanalyzedResponseIds,
} from "@/domains/responses/ai-insights";

/**
 * AI over responses (Phase 3, Wave B). Each action: AI configured →
 * the form is in the caller's workspace → they can edit and can see
 * responses → rate limit → credits (spent per response / per summary in
 * the domain) → the model. Results are stored beside the responses.
 */

type Ctx = Awaited<ReturnType<typeof getCurrentWorkspace>>;

async function gate(
  formId: string,
  limitKey: string,
  perHour: number,
): Promise<{ ok: true; ctx: Ctx } | AiFailure> {
  if (!aiConfigured()) return AI_NOT_CONFIGURED;
  if (!z.string().uuid().safeParse(formId).success)
    return { ok: false, code: "failed", message: "Form not found." };
  const ctx = await getCurrentWorkspace();
  const { data } = await ctx.supabase
    .from("forms")
    .select("id")
    .eq("id", formId)
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) return { ok: false, code: "failed", message: "Form not found." };
  if (
    !canEdit(ctx.workspace.role) ||
    !(await hasPermission(ctx.supabase, ctx.workspace.id, "view_responses"))
  ) {
    return {
      ok: false,
      code: "failed",
      message: "You don't have permission to analyze these responses.",
    };
  }
  const limit = await hitRateLimit(
    createAdminClient(),
    `${limitKey}:${ctx.user.id}`,
    perHour,
    3_600_000,
  );
  if (!limit.allowed) {
    return {
      ok: false,
      code: "limited",
      message: "That's a lot for one hour. Try again later.",
    };
  }
  return { ok: true, ctx };
}

export type AnalyzeResult =
  | {
      ok: true;
      analyzed: number;
      failed: number;
      outOfCredits: boolean;
      remaining: boolean;
    }
  | AiFailure;

/** Sentiment, tags and lead score for responses that don't have them yet
 * (up to a batch per click), or for one response again. */
export async function analyzeResponsesAction(
  formId: string,
  responseId?: string,
): Promise<AnalyzeResult> {
  if (responseId !== undefined && !z.string().uuid().safeParse(responseId).success)
    return { ok: false, code: "failed", message: "Response not found." };
  const gated = await gate(formId, "ai-analyze", 30);
  if (!gated.ok) return gated;
  const { workspace } = gated.ctx;
  const admin = createAdminClient();
  try {
    const { entitlements } = await getWorkspacePlan(admin, workspace.id);
    const ids = responseId ? [responseId] : await unanalyzedResponseIds(admin, formId);
    if (ids.length === 0)
      return { ok: true, analyzed: 0, failed: 0, outOfCredits: false, remaining: false };
    const result = await analyzeResponses(admin, {
      formId,
      workspaceId: workspace.id,
      responseIds: ids,
      entitlements,
    });
    revalidatePath(`/forms/${formId}/responses`);
    if (result.analyzed === 0 && result.outOfCredits) return AI_OUT_OF_CREDITS;
    const remaining = responseId
      ? false
      : (await unanalyzedResponseIds(admin, formId, 1)).length > 0;
    return { ok: true, ...result, remaining };
  } catch (error) {
    return aiFailure(error);
  }
}

export type SummarizeResult = { ok: true } | AiFailure;

/** A written summary of the form's responses, with real quotes. */
export async function summarizeResponsesAction(formId: string): Promise<SummarizeResult> {
  const gated = await gate(formId, "ai-summary", 10);
  if (!gated.ok) return gated;
  const { workspace, user } = gated.ctx;
  const admin = createAdminClient();
  try {
    const { entitlements } = await getWorkspacePlan(admin, workspace.id);
    const outcome = await generateFormSummary(admin, {
      formId,
      workspaceId: workspace.id,
      userId: user.id,
      entitlements,
    });
    if (outcome === "out_of_credits") return AI_OUT_OF_CREDITS;
    if (outcome === "no_responses")
      return {
        ok: false,
        code: "failed",
        message: "There are no written answers to summarize yet.",
      };
    if (outcome === "failed")
      return {
        ok: false,
        code: "failed",
        message: "The summary didn't come back. Try again.",
      };
    revalidatePath(`/forms/${formId}/responses`);
    return { ok: true };
  } catch (error) {
    return aiFailure(error);
  }
}

/** What a good lead looks like for this form (used by AI lead scoring). */
export async function setLeadCriteriaAction(
  formId: string,
  criteria: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const text = criteria.trim();
  if (text.length > 1000)
    return { ok: false, message: "Keep it under 1,000 characters." };
  const { supabase, workspace } = await getCurrentWorkspace();
  if (!canEdit(workspace.role))
    return { ok: false, message: "You can't change this form." };
  const { data, error } = await supabase
    .from("forms")
    .update({ ai_lead_criteria: text || null })
    .eq("id", formId)
    .eq("workspace_id", workspace.id)
    .select("id");
  if (error || !data?.length) return { ok: false, message: "Couldn't save that." };
  revalidatePath(`/forms/${formId}/responses`);
  return { ok: true };
}
