"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createFormWithDraft, duplicateForm, softDeleteForm } from "@/domains/forms";
import { getTemplateById } from "@/domains/templates";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { trackEvent } from "@/lib/analytics/track";
import Anthropic from "@anthropic-ai/sdk";
import { aiConfigured, MAX_FORM_PROMPT_LENGTH } from "@/domains/ai/config";
import { generateForm } from "@/domains/ai/generate-form";
import { hitRateLimit } from "@/domains/abuse/shared-rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWorkspacePlan, spendAiCredit } from "@/domains/billing";

export async function createFormAction(): Promise<void> {
  const { supabase, user, workspace } = await getCurrentWorkspace();
  const { id } = await createFormWithDraft(
    supabase,
    workspace.id,
    user.id,
    "Untitled form",
  );
  trackEvent({
    formId: id,
    eventType: "form_created",
    actorId: user.id,
    metadata: { source: "scratch" },
  });
  redirect(`/forms/${id}`);
}

/** "Try a sample form" (first-run welcome): a copy of the first
 * template, ready to poke around in. Falls back to a blank form if no
 * templates are installed. */
export async function createSampleFormAction(): Promise<void> {
  const { supabase } = await getCurrentWorkspace();
  const { data } = await supabase
    .from("templates")
    .select("id")
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return createFormAction();
  return createFormFromTemplateAction(data.id);
}

export async function createFormFromTemplateAction(templateId: string): Promise<void> {
  const { supabase, user, workspace } = await getCurrentWorkspace();
  const template = await getTemplateById(supabase, templateId);
  if (!template) redirect("/templates");

  const { id } = await createFormWithDraft(
    supabase,
    workspace.id,
    user.id,
    template.schema.meta.title,
    template.schema,
  );
  trackEvent({
    formId: id,
    eventType: "form_created",
    actorId: user.id,
    metadata: { source: "template", templateId },
  });
  redirect(`/forms/${id}`);
}

export type GenerateFormState = { message: string } | null;

/**
 * "Describe your form" (Phase 31): the model drafts, buildGeneratedForm
 * turns the draft into a schema that has passed the same validation as
 * a saved draft, and it becomes an ordinary new draft the creator edits
 * before publishing. Nothing is published.
 */
export async function generateFormAction(
  _previous: GenerateFormState,
  formData: FormData,
): Promise<GenerateFormState> {
  if (!aiConfigured()) {
    return { message: "AI isn't set up on this server (ANTHROPIC_API_KEY is missing)." };
  }
  const prompt = String(formData.get("prompt") ?? "").trim();
  if (!prompt) return { message: "Describe the form you want." };
  if (prompt.length > MAX_FORM_PROMPT_LENGTH) {
    return { message: `Keep it under ${MAX_FORM_PROMPT_LENGTH} characters.` };
  }

  const { supabase, user, workspace } = await getCurrentWorkspace();
  const limit = await hitRateLimit(
    createAdminClient(),
    `ai-form:${user.id}`,
    10,
    3_600_000,
  );
  if (!limit.allowed) {
    return { message: "That's a lot of generated forms for one hour. Try again later." };
  }
  const admin = createAdminClient();
  const { entitlements } = await getWorkspacePlan(admin, workspace.id);
  if (!(await spendAiCredit(admin, workspace.id, entitlements))) {
    return { message: "You've used this month's AI credits on your plan." };
  }

  let result;
  try {
    result = await generateForm(prompt);
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { message: "The AI is busy. Try again in a minute." };
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return { message: "The server's ANTHROPIC_API_KEY was rejected." };
    }
    return { message: "The AI couldn't be reached. Try again." };
  }
  if (!result.ok) return { message: result.message };

  const { id } = await createFormWithDraft(
    supabase,
    workspace.id,
    user.id,
    result.schema.meta.title,
    result.schema,
  );
  trackEvent({
    formId: id,
    eventType: "form_created",
    actorId: user.id,
    metadata: { source: "ai", warnings: result.warnings.length },
  });
  redirect(`/forms/${id}`);
}

const FormId = z.string().uuid();

export async function duplicateFormAction(
  formId: string,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  if (!FormId.safeParse(formId).success) return { ok: false, message: "Form not found." };
  const { supabase, user, workspace } = await getCurrentWorkspace();
  try {
    const copy = await duplicateForm(supabase, formId, workspace.id, user.id);
    if (!copy) return { ok: false, message: "Form not found." };
    trackEvent({
      formId: copy.id,
      eventType: "form_created",
      actorId: user.id,
      metadata: { source: "duplicate" },
    });
    revalidatePath("/dashboard");
    return { ok: true, id: copy.id };
  } catch {
    return { ok: false, message: "Couldn't duplicate the form. Please try again." };
  }
}

export async function deleteFormAction(
  formId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!FormId.safeParse(formId).success) return { ok: false, message: "Form not found." };
  const { supabase, workspace } = await getCurrentWorkspace();
  try {
    await softDeleteForm(supabase, formId, workspace.id);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch {
    return { ok: false, message: "Couldn't delete the form. Please try again." };
  }
}
