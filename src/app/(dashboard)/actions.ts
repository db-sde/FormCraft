"use server";

import { redirect } from "next/navigation";
import { createFormWithDraft } from "@/domains/forms";
import { getTemplateById } from "@/domains/templates";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";

export async function createFormAction(): Promise<void> {
  const { supabase, user, workspace } = await getCurrentWorkspace();
  const { id } = await createFormWithDraft(
    supabase,
    workspace.id,
    user.id,
    "Untitled form",
  );
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
  redirect(`/forms/${id}`);
}
