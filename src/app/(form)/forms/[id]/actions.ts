"use server";

import { revalidatePath } from "next/cache";
import {
  saveDraftSchema,
  publishForm,
  unpublishForm,
  renameForm,
  StaleDraftError,
  FormSchemaError,
  schemaErrorMessage,
  MAX_FORM_TITLE_LENGTH,
} from "@/domains/forms";
import type { FormSchemaV1 } from "@/domains/forms";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { trackEvent } from "@/lib/analytics/track";
import { parseFormSchema } from "@/domains/forms/schema";
import { hitRateLimit } from "@/domains/abuse/shared-rate-limit";
import type { RuleProposal } from "@/domains/ai/rule-draft";
import { aiConfigured, MAX_INSTRUCTION_LENGTH } from "@/domains/ai/config";
import { proposeRule } from "@/domains/ai/propose-rule";
import Anthropic from "@anthropic-ai/sdk";
import { getWorkspacePlan, spendAiCredit } from "@/domains/billing";
import { canEdit } from "@/domains/workspaces";
import { audit } from "@/domains/audit";
import { isWoff2, MAX_FONT_BYTES } from "@/domains/themes/fonts";
import { hasPermission } from "@/domains/workspaces/permissions";

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
      return { ok: false, code: "invalid", message: schemaErrorMessage(error) };
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
  const { supabase, user, workspace } = await getCurrentWorkspace();
  // Publishing writes with the service role, so the right to edit is
  // checked here explicitly (reading the draft alone isn't enough:
  // viewers can read it).
  if (
    !canEdit(workspace.role) ||
    !(await formInWorkspace(supabase, formId, workspace.id)) ||
    !(await hasPermission(supabase, workspace.id, "publish"))
  ) {
    return { ok: false, code: "unknown", message: "You can't publish this form." };
  }

  try {
    const admin = createAdminClient();
    const result = await publishForm(supabase, formId, admin, user.id);
    await audit(admin, {
      workspaceId: workspace.id,
      actorId: user.id,
      action: "form.published",
      target: { type: "form", id: formId },
      metadata: { version: result.versionNumber },
    });
    revalidatePath(`/forms/${formId}`);
    trackEvent({
      formId,
      eventType: "form_published",
      actorId: user.id,
      metadata: { version: result.versionNumber },
    });
    return { ok: true, publishedVersionNumber: result.versionNumber };
  } catch (error) {
    if (error instanceof FormSchemaError) {
      return { ok: false, code: "invalid", message: schemaErrorMessage(error) };
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
  const { supabase, user, workspace } = await getCurrentWorkspace();
  if (
    !canEdit(workspace.role) ||
    !(await hasPermission(supabase, workspace.id, "publish"))
  )
    return { ok: false, message: "You can't unpublish this form." };

  try {
    await unpublishForm(supabase, formId);
    await audit(createAdminClient(), {
      workspaceId: workspace.id,
      actorId: user.id,
      action: "form.unpublished",
      target: { type: "form", id: formId },
    });
    revalidatePath(`/forms/${formId}`);
    trackEvent({ formId, eventType: "form_unpublished", actorId: user.id });
    return { ok: true };
  } catch {
    return { ok: false, message: "Failed to unpublish. Please try again." };
  }
}

const BUILDER_EVENTS = ["question_added", "form_previewed"] as const;

/** Product events that happen purely in the builder's browser state
 * (they reach the server only via autosave otherwise). Ownership is
 * checked so events can't be attributed to someone else's form. */
export async function trackBuilderEventAction(
  formId: string,
  eventType: (typeof BUILDER_EVENTS)[number],
  questionType?: string,
): Promise<void> {
  if (!BUILDER_EVENTS.includes(eventType)) return;
  const { supabase, user, workspace } = await getCurrentWorkspace();
  const { data } = await supabase
    .from("forms")
    .select("id")
    .eq("id", formId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!data) return;
  trackEvent({
    formId,
    eventType,
    actorId: user.id,
    metadata: questionType ? { questionType: questionType.slice(0, 40) } : undefined,
  });
}

export type ProposeRuleResult =
  | { ok: true; proposal: RuleProposal }
  | { ok: false; code: "not_configured" | "limited" | "failed"; message: string };

/**
 * "Describe a rule" (Phase 30): the model proposes, the creator decides.
 * Nothing is saved here — the proposal goes back to the builder, and if
 * accepted it reaches the draft through the normal autosave path and
 * its validation. The schema comes from the builder (it may hold edits
 * autosave hasn't sent yet), so it is re-parsed; the form itself must be
 * in the caller's workspace.
 */
export async function proposeRuleAction(
  formId: string,
  instruction: string,
  schema: FormSchemaV1,
): Promise<ProposeRuleResult> {
  if (!aiConfigured()) {
    return {
      ok: false,
      code: "not_configured",
      message: "AI isn't set up on this server (ANTHROPIC_API_KEY is missing).",
    };
  }
  const text = instruction.trim();
  if (!text)
    return { ok: false, code: "failed", message: "Describe what should happen." };
  if (text.length > MAX_INSTRUCTION_LENGTH) {
    return {
      ok: false,
      code: "failed",
      message: `Keep it under ${MAX_INSTRUCTION_LENGTH} characters.`,
    };
  }

  const { supabase, user, workspace } = await getCurrentWorkspace();
  const { data } = await supabase
    .from("forms")
    .select("id")
    .eq("id", formId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!data) return { ok: false, code: "failed", message: "Form not found." };

  const limit = await hitRateLimit(
    createAdminClient(),
    `ai-rule:${user.id}`,
    30,
    3_600_000,
  );
  if (!limit.allowed) {
    return {
      ok: false,
      code: "limited",
      message: "That's a lot of AI rules for one hour. Try again later.",
    };
  }
  const admin = createAdminClient();
  const { entitlements } = await getWorkspacePlan(admin, workspace.id);
  if (!(await spendAiCredit(admin, workspace.id, entitlements))) {
    return {
      ok: false,
      code: "limited",
      message: "You've used this month's AI credits on your plan.",
    };
  }

  let parsed: FormSchemaV1;
  try {
    parsed = parseFormSchema(schema);
  } catch {
    return { ok: false, code: "failed", message: "Save your form's changes first." };
  }

  try {
    const result = await proposeRule(text, parsed);
    return result.ok
      ? { ok: true, proposal: result.proposal }
      : { ok: false, code: "failed", message: result.message };
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return {
        ok: false,
        code: "limited",
        message: "The AI is busy. Try again in a minute.",
      };
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return {
        ok: false,
        code: "not_configured",
        message: "The server's ANTHROPIC_API_KEY was rejected.",
      };
    }
    return {
      ok: false,
      code: "failed",
      message: "The AI couldn't be reached. Try again.",
    };
  }
}

export type FontUploadResult =
  { ok: true; url: string; name: string } | { ok: false; message: string };

/**
 * Uploads a licensed WOFF2 font for this form's theme (P2.22). Checked
 * here, not in the browser: the plan includes custom fonts, the caller
 * can edit the form, the file really is WOFF2 and small, and the
 * creator confirmed they may use it on the web. Stored in the
 * workspace's theme folder, the only place a theme font may come from.
 */
export async function uploadThemeFontAction(
  formId: string,
  formData: FormData,
): Promise<FontUploadResult> {
  const { supabase, workspace } = await getCurrentWorkspace();
  if (!canEdit(workspace.role))
    return { ok: false, message: "You have view-only access." };
  const { data: form } = await supabase
    .from("forms")
    .select("id")
    .eq("id", formId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!form) return { ok: false, message: "Form not found." };

  const admin = createAdminClient();
  const { entitlements } = await getWorkspacePlan(admin, workspace.id);
  if (!entitlements.custom_fonts) {
    return { ok: false, message: "Your own fonts are part of paid plans." };
  }
  if (formData.get("licensed") !== "yes") {
    return { ok: false, message: "Confirm you're licensed to use this font on the web." };
  }
  const name = String(formData.get("name") ?? "")
    .trim()
    .slice(0, 60);
  if (!name) return { ok: false, message: "Give the font a name." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose a .woff2 file." };
  }
  if (file.size > MAX_FONT_BYTES)
    return { ok: false, message: "Fonts can be up to 2 MB." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isWoff2(bytes)) return { ok: false, message: "That isn't a WOFF2 font file." };

  const path = `${workspace.id}/fonts/${crypto.randomUUID()}.woff2`;
  const { error } = await admin.storage
    .from("theme-assets")
    .upload(path, bytes, { contentType: "font/woff2", upsert: false });
  if (error) return { ok: false, message: "The upload failed. Try again." };
  const { data } = admin.storage.from("theme-assets").getPublicUrl(path);
  return { ok: true, url: data.publicUrl, name };
}

async function formInWorkspace(
  supabase: Awaited<ReturnType<typeof getCurrentWorkspace>>["supabase"],
  formId: string,
  workspaceId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("forms")
    .select("id")
    .eq("id", formId)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .maybeSingle();
  return !!data;
}
