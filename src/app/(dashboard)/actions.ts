"use server";

import { SWITCHED_OFF, featureEnabled } from "@/domains/flags";
import { cannotCreate } from "@/domains/workspaces/status";
import { rateLimit } from "@/domains/abuse/limit";

import { recordAudit } from "@/domains/audit/record";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { WORKSPACE_COOKIE } from "@/lib/auth/current-workspace";
import { canEdit } from "@/domains/workspaces";
import { z } from "zod";
import {
  createFolder,
  createFormWithDraft,
  blankFormSchema,
  deleteFolder,
  duplicateForm,
  getDraftForEdit,
  FolderError,
  moveFormToFolder,
  renameFolder,
  softDeleteForm,
  archiveForm,
  restoreForm,
  type UpcomingBooking,
} from "@/domains/forms";
import {
  deleteWorkspaceTemplate,
  duplicateWorkspaceTemplate,
  getTemplateById,
  saveFormAsTemplate,
  schemaFromWorkspaceTemplate,
  TEMPLATE_VISIBILITIES,
  TemplateError,
  updateWorkspaceTemplate,
} from "@/domains/templates";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { trackEvent } from "@/lib/analytics/track";
import Anthropic from "@anthropic-ai/sdk";
import { aiConfigured, MAX_FORM_PROMPT_LENGTH } from "@/domains/ai/config";
import { generateForm } from "@/domains/ai/generate-form";
import { hitRateLimit } from "@/domains/abuse/shared-rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWorkspacePlan } from "@/domains/billing";
import { beginAi } from "@/domains/ai/gateway";
import { countLeadsForForm } from "@/domains/leads";
import { ImportError, importFromUrl } from "@/domains/forms/import";
import type { Json } from "@/lib/supabase/database.types";
import { notSetUpMessage } from "@/lib/not-set-up";
import { planBlocks } from "@/domains/billing/entitlements";

export async function createFormAction(): Promise<void> {
  const { supabase, user, workspace } = await getCurrentWorkspace();
  if (!canEdit(workspace.role) || cannotCreate(workspace)) redirect("/dashboard");
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

/** A blank form: only a welcome screen (QA FC4-26). */
export async function createBlankFormAction(): Promise<void> {
  const { supabase, user, workspace } = await getCurrentWorkspace();
  if (!canEdit(workspace.role) || cannotCreate(workspace)) redirect("/dashboard");
  const { id } = await createFormWithDraft(
    supabase,
    workspace.id,
    user.id,
    "Untitled form",
    blankFormSchema("Untitled form"),
  );
  trackEvent({
    formId: id,
    eventType: "form_created",
    actorId: user.id,
    metadata: { source: "blank" },
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
  if (!canEdit(workspace.role) || cannotCreate(workspace)) redirect("/dashboard");
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
    return { message: notSetUpMessage("Writing forms with AI") };
  }
  const prompt = String(formData.get("prompt") ?? "").trim();
  if (!prompt) return { message: "Describe the form you want." };
  if (prompt.length > MAX_FORM_PROMPT_LENGTH) {
    return { message: `Keep it under ${MAX_FORM_PROMPT_LENGTH} characters.` };
  }

  const { supabase, user, workspace } = await getCurrentWorkspace();
  if (!canEdit(workspace.role)) {
    return { message: "You have view-only access to this workspace." };
  }
  if (cannotCreate(workspace)) {
    return { message: cannotCreate(workspace)! };
  }
  const limit = await rateLimit(`ai-form:${user.id}`, 10, 3_600_000);
  if (!limit.allowed) {
    return { message: "That's a lot of generated forms for one hour. Try again later." };
  }
  const admin = createAdminClient();
  const { entitlements } = await getWorkspacePlan(admin, workspace.id);
  const begun = await beginAi(admin, {
    feature: "form_generate",
    workspaceId: workspace.id,
    entitlements,
  });
  if (!begun.ok) return { message: begun.message };

  let result;
  try {
    result = await generateForm(begun.ai, prompt);
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { message: "The AI is busy. Try again in a minute." };
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return {
        message: "AI is having a moment on our side. Please try again a little later.",
      };
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

export type ImportFormState = { message: string } | null;

/**
 * "Import from a link" (F-05): a public Google Form or typeform becomes
 * an unpublished draft with a report of what came over. Nothing is
 * published and no responses are imported; the creator reviews it in the
 * builder and publishes it themselves.
 */
export async function importFormAction(
  _previous: ImportFormState,
  formData: FormData,
): Promise<ImportFormState> {
  const link = String(formData.get("url") ?? "").trim();
  if (!link) return { message: "Paste the form's link." };
  if (link.length > 2000) return { message: "That link is too long." };
  const { supabase, user, workspace } = await getCurrentWorkspace();
  if (!canEdit(workspace.role)) {
    return { message: "You have view-only access to this workspace." };
  }
  if (cannotCreate(workspace)) {
    return { message: cannotCreate(workspace)! };
  }
  const admin = createAdminClient();
  const limit = await hitRateLimit(admin, `import-form:${user.id}`, 20, 3_600_000);
  if (!limit.allowed) {
    return { message: "That's a lot of imports for one hour. Try again later." };
  }

  let result;
  try {
    result = await importFromUrl(link);
  } catch (error) {
    if (error instanceof ImportError) return { message: error.message };
    return { message: "That form couldn't be imported. Try again." };
  }

  const { id } = await createFormWithDraft(
    supabase,
    workspace.id,
    user.id,
    result.schema.meta.title,
    result.schema,
  );
  // The report rides on the form until the creator dismisses it.
  await admin
    .from("forms")
    .update({ import_report: result.report as unknown as Json })
    .eq("id", id)
    .eq("workspace_id", workspace.id);
  trackEvent({
    formId: id,
    eventType: "form_created",
    actorId: user.id,
    metadata: {
      source: "import",
      importSource: result.report.source,
      unknown: result.report.fields.filter((f) => f.status === "unknown").length,
    },
  });
  redirect(`/forms/${id}`);
}

const FormId = z.string().uuid();

export async function duplicateFormAction(
  formId: string,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  if (!FormId.safeParse(formId).success) return { ok: false, message: "Form not found." };
  const { supabase, user, workspace } = await getCurrentWorkspace();
  if (!canEdit(workspace.role)) {
    return { ok: false, message: "You have view-only access to this workspace." };
  }
  if (cannotCreate(workspace)) return { ok: false, message: cannotCreate(workspace)! };
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
  if (!canEdit(workspace.role)) {
    return { ok: false, message: "You have view-only access to this workspace." };
  }
  try {
    await softDeleteForm(supabase, formId, workspace.id);
    await recordAudit({
      workspaceId: workspace.id,
      actorId: (await supabase.auth.getUser()).data.user?.id ?? null,
      action: "form.deleted",
      target: { type: "form", id: formId },
    });
    revalidatePath("/dashboard");
    return { ok: true };
  } catch {
    return { ok: false, message: "Couldn't delete the form. Please try again." };
  }
}

/** Archives a form or restores it (every plan). */
export type ArchiveActionResult =
  | { ok: true; cancelled?: number }
  | { ok: false; message: string }
  | {
      ok: false;
      code: "upcoming_bookings";
      message: string;
      count: number;
      bookings: UpcomingBooking[];
    };

/** Archives or restores one form (owners, admins and editors). Archiving
 * a form with upcoming bookings needs `keepBookings` (developer spec 4). */
export async function archiveFormAction(
  formId: string,
  archived: boolean,
  keepBookings = false,
): Promise<ArchiveActionResult> {
  if (!FormId.safeParse(formId).success) return { ok: false, message: "Form not found." };
  const { supabase, workspace, user } = await getCurrentWorkspace();
  if (!canEdit(workspace.role)) {
    return { ok: false, message: "You have view-only access to this workspace." };
  }
  if (archived && !(await featureEnabled("form_archiving", workspace.id)))
    return { ok: false, message: SWITCHED_OFF };
  try {
    if (archived) {
      const result = await archiveForm(supabase, formId, Boolean(keepBookings));
      if (!result.ok) {
        if (result.code === "upcoming_bookings") {
          return {
            ok: false,
            code: "upcoming_bookings",
            count: result.count,
            bookings: result.bookings,
            message: `This form has ${result.count} upcoming booking${result.count === 1 ? "" : "s"}.`,
          };
        }
        return { ok: false, message: "You can't archive this form." };
      }
      await recordAudit({
        workspaceId: workspace.id,
        actorId: user.id,
        action: "form.archived",
        target: { type: "form", id: formId },
        metadata: {
          cancelledDeliveries: result.cancelled,
          keptBookings: Boolean(keepBookings),
        },
      });
      revalidatePath("/dashboard");
      return { ok: true, cancelled: result.cancelled };
    }
    const result = await restoreForm(supabase, formId);
    if (!result.ok) return { ok: false, message: "You can't restore this form." };
    await recordAudit({
      workspaceId: workspace.id,
      actorId: user.id,
      action: "form.restored",
      target: { type: "form", id: formId },
    });
    revalidatePath("/dashboard");
    return { ok: true };
  } catch {
    return { ok: false, message: "Couldn't change that. Please try again." };
  }
}

/** Archives or restores several forms at once, one audit entry each.
 * Forms with upcoming bookings are left as they are and named, so the
 * user can decide about each one. */
export async function archiveFormsAction(
  formIds: string[],
  archived: boolean,
): Promise<
  { ok: true; changed: number; withBookings: string[] } | { ok: false; message: string }
> {
  const ids = z.array(FormId).max(200).safeParse(formIds);
  if (!ids.success || ids.data.length === 0)
    return { ok: false, message: "Choose forms first." };
  const { supabase, workspace, user } = await getCurrentWorkspace();
  if (!canEdit(workspace.role)) {
    return { ok: false, message: "You have view-only access to this workspace." };
  }
  if (archived && !(await featureEnabled("form_archiving", workspace.id)))
    return { ok: false, message: SWITCHED_OFF };
  let changed = 0;
  const withBookings: string[] = [];
  for (const id of new Set(ids.data)) {
    try {
      const result = archived
        ? await archiveForm(supabase, id)
        : await restoreForm(supabase, id);
      if (!result.ok) {
        if (result.code === "upcoming_bookings") withBookings.push(id);
        continue;
      }
      changed += 1;
      await recordAudit({
        workspaceId: workspace.id,
        actorId: user.id,
        action: archived ? "form.archived" : "form.restored",
        target: { type: "form", id },
        metadata: { bulk: true },
      });
    } catch {
      // Left as it was; the count says how many changed.
    }
  }
  revalidatePath("/dashboard");
  return { ok: true, changed, withBookings };
}

/** Leads a form has, for the delete dialog's warning. */
export async function formLeadCountAction(formId: string): Promise<number | null> {
  if (!FormId.safeParse(formId).success) return null;
  const { supabase, workspace } = await getCurrentWorkspace();
  try {
    return await countLeadsForForm(supabase, workspace.id, formId);
  } catch {
    return null;
  }
}

/** Switches the workspace the app shows. Only a workspace the user is a
 * member of can be chosen; the cookie is a preference, re-checked on
 * every request. */
export async function switchWorkspaceAction(workspaceId: string): Promise<void> {
  const { workspaces } = await getCurrentWorkspace();
  if (!workspaces.some((w) => w.id === workspaceId)) return;
  (await cookies()).set(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export type FolderResult =
  { ok: true; folder?: { id: string; name: string } } | { ok: false; message: string };

async function editableWorkspace() {
  const ctx = await getCurrentWorkspace();
  return canEdit(ctx.workspace.role) ? ctx : null;
}

export async function createFolderAction(name: string): Promise<FolderResult> {
  const ctx = await editableWorkspace();
  if (!ctx) return { ok: false, message: "You have view-only access to this workspace." };
  const blocked = await planBlocks(ctx.supabase, ctx.workspace.id, "folders");
  if (blocked) return { ok: false, message: blocked };
  try {
    const folder = await createFolder(ctx.supabase, ctx.workspace.id, name);
    revalidatePath("/dashboard");
    return { ok: true, folder };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof FolderError ? error.message : "Couldn't create it.",
    };
  }
}

export async function renameFolderAction(
  folderId: string,
  name: string,
): Promise<FolderResult> {
  const ctx = await editableWorkspace();
  if (!ctx || !FormId.safeParse(folderId).success)
    return { ok: false, message: "Folder not found." };
  try {
    await renameFolder(ctx.supabase, ctx.workspace.id, folderId, name);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof FolderError ? error.message : "Couldn't rename it.",
    };
  }
}

export async function deleteFolderAction(folderId: string): Promise<FolderResult> {
  const ctx = await editableWorkspace();
  if (!ctx || !FormId.safeParse(folderId).success)
    return { ok: false, message: "Folder not found." };
  try {
    await deleteFolder(ctx.supabase, ctx.workspace.id, folderId);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof FolderError ? error.message : "Couldn't delete it.",
    };
  }
}

export async function moveFormToFolderAction(
  formId: string,
  folderId: string | null,
): Promise<FolderResult> {
  const ctx = await editableWorkspace();
  if (
    !ctx ||
    !FormId.safeParse(formId).success ||
    (folderId !== null && !FormId.safeParse(folderId).success)
  ) {
    return { ok: false, message: "Form not found." };
  }
  try {
    await moveFormToFolder(ctx.supabase, ctx.workspace.id, formId, folderId);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof FolderError ? error.message : "Couldn't move it.",
    };
  }
}

// --- custom templates (F-61) ---------------------------------------------------

const TemplateInput = z.object({
  title: z.string().trim().min(1, "Give the template a name.").max(120),
  description: z.string().max(500).optional(),
  category: z.string().max(40).optional(),
  visibility: z.enum(TEMPLATE_VISIBILITIES),
});

/** Saves a form's current draft as a template. Only the schema goes in:
 * no responses, integrations, keys or payment settings. */
export async function saveFormAsTemplateAction(
  formId: string,
  input: z.input<typeof TemplateInput>,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  if (!FormId.safeParse(formId).success) return { ok: false, message: "Form not found." };
  const parsed = TemplateInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Check the details.",
    };
  }
  const { supabase, user, workspace } = await getCurrentWorkspace();
  if (!canEdit(workspace.role)) {
    return { ok: false, message: "You have view-only access to this workspace." };
  }
  if (!(await rateLimit(`template:${user.id}`, 30, 60 * 60 * 1000)).allowed) {
    return { ok: false, message: "That's a lot of templates. Try again in a while." };
  }
  const draft = await getDraftForEdit(supabase, formId, workspace.id);
  if (!draft) return { ok: false, message: "Form not found." };
  try {
    const saved = await saveFormAsTemplate(supabase, {
      workspaceId: workspace.id,
      userId: user.id,
      schema: draft.schema,
      sourceFormId: formId,
      ...parsed.data,
    });
    void recordAudit({
      workspaceId: workspace.id,
      actorId: user.id,
      action: "template.created",
      target: { type: "template", id: saved.id },
      metadata: { formId, visibility: parsed.data.visibility },
    });
    revalidatePath("/templates");
    return { ok: true, id: saved.id };
  } catch (error) {
    if (error instanceof TemplateError) return { ok: false, message: error.message };
    return { ok: false, message: "Couldn't save the template. Please try again." };
  }
}

export async function createFormFromWorkspaceTemplateAction(
  templateId: string,
): Promise<void> {
  if (!FormId.safeParse(templateId).success) redirect("/templates");
  const { supabase, user, workspace } = await getCurrentWorkspace();
  if (!canEdit(workspace.role)) redirect("/dashboard");
  const template = await schemaFromWorkspaceTemplate(supabase, workspace.id, templateId);
  if (!template) redirect("/templates");
  const { id } = await createFormWithDraft(
    supabase,
    workspace.id,
    user.id,
    template.title,
    template.schema,
  );
  trackEvent({
    formId: id,
    eventType: "form_created",
    actorId: user.id,
    metadata: { source: "workspace_template", templateId },
  });
  redirect(`/forms/${id}`);
}

export async function duplicateWorkspaceTemplateAction(
  templateId: string,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  if (!FormId.safeParse(templateId).success) {
    return { ok: false, message: "Template not found." };
  }
  const { supabase, user, workspace } = await getCurrentWorkspace();
  if (!canEdit(workspace.role)) {
    return { ok: false, message: "You have view-only access to this workspace." };
  }
  try {
    const copy = await duplicateWorkspaceTemplate(supabase, {
      workspaceId: workspace.id,
      userId: user.id,
      templateId,
    });
    if (!copy) return { ok: false, message: "Template not found." };
    void recordAudit({
      workspaceId: workspace.id,
      actorId: user.id,
      action: "template.created",
      target: { type: "template", id: copy.id },
      metadata: { copiedFrom: templateId, visibility: "private" },
    });
    revalidatePath("/templates");
    return { ok: true, id: copy.id };
  } catch (error) {
    if (error instanceof TemplateError) return { ok: false, message: error.message };
    return { ok: false, message: "Couldn't copy the template. Please try again." };
  }
}

export async function updateWorkspaceTemplateAction(
  templateId: string,
  patch: { title?: string; category?: string; visibility?: "private" | "workspace" },
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!FormId.safeParse(templateId).success) {
    return { ok: false, message: "Template not found." };
  }
  const parsed = z
    .object({
      title: z.string().max(120).optional(),
      category: z.string().max(40).optional(),
      visibility: z.enum(TEMPLATE_VISIBILITIES).optional(),
    })
    .safeParse(patch);
  if (!parsed.success) return { ok: false, message: "Check the details." };
  const { supabase, workspace } = await getCurrentWorkspace();
  try {
    const changed = await updateWorkspaceTemplate(
      supabase,
      workspace.id,
      templateId,
      parsed.data,
    );
    if (!changed) {
      return {
        ok: false,
        message: "Only its creator or an admin can change this template.",
      };
    }
    revalidatePath("/templates");
    return { ok: true };
  } catch (error) {
    if (error instanceof TemplateError) return { ok: false, message: error.message };
    return { ok: false, message: "Couldn't change the template. Please try again." };
  }
}

export async function deleteWorkspaceTemplateAction(
  templateId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!FormId.safeParse(templateId).success) {
    return { ok: false, message: "Template not found." };
  }
  const { supabase, user, workspace } = await getCurrentWorkspace();
  const removed = await deleteWorkspaceTemplate(supabase, workspace.id, templateId).catch(
    () => false,
  );
  if (!removed) {
    return {
      ok: false,
      message: "Only its creator or an admin can delete this template.",
    };
  }
  void recordAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "template.deleted",
    target: { type: "template", id: templateId },
  });
  revalidatePath("/templates");
  return { ok: true };
}
