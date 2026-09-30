"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createFormWithDraft, duplicateForm, softDeleteForm } from "@/domains/forms";
import { getTemplateById } from "@/domains/templates";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { trackEvent } from "@/lib/analytics/track";

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
