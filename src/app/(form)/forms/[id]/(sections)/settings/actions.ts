"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  updatePartialResponseSettings,
  setResumeLinksEnabled,
  updateFormSlug,
  SlugTakenError,
} from "@/domains/forms";
import { setNotificationsEnabled } from "@/domains/notifications";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/domains/audit";
import { canEdit } from "@/domains/workspaces";
import { restoreVersionIntoDraft, RestoreError } from "@/domains/forms/versions/history";
import { hasPermission } from "@/domains/workspaces/permissions";
import { EntitlementError, requireFeature } from "@/domains/billing/entitlements";
import {
  createExperiment,
  ExperimentError,
  stopExperiment,
  type Arm,
} from "@/domains/experiments";

export type SettingsResult = { ok: true } | { ok: false; message: string };

const RETENTION_CHOICES = [null, 30, 90, 180, 365] as const;

async function ownFormOrFail(formId: string) {
  const { supabase, workspace } = await getCurrentWorkspace();
  const { data } = await supabase
    .from("forms")
    .select("id")
    .eq("id", formId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  return data ? { supabase, workspace } : null;
}

export async function updateUnfinishedSettingsAction(
  formId: string,
  settings: { savePartialResponses: boolean; partialRetentionDays: number | null },
): Promise<SettingsResult> {
  if (!RETENTION_CHOICES.includes(settings.partialRetentionDays as never)) {
    return { ok: false, message: "Choose one of the listed retention periods." };
  }
  const ctx = await ownFormOrFail(formId);
  if (!ctx) return { ok: false, message: "Form not found." };
  try {
    await updatePartialResponseSettings(ctx.supabase, formId, ctx.workspace.id, {
      savePartialResponses: Boolean(settings.savePartialResponses),
      partialRetentionDays: settings.partialRetentionDays,
    });
    revalidatePath(`/forms/${formId}/settings`);
    return { ok: true };
  } catch {
    return { ok: false, message: "Couldn't save the setting. Please try again." };
  }
}

export async function setResumeLinksAction(
  formId: string,
  enabled: boolean,
): Promise<SettingsResult> {
  const ctx = await ownFormOrFail(formId);
  if (!ctx) return { ok: false, message: "Form not found." };
  try {
    await setResumeLinksEnabled(ctx.supabase, formId, ctx.workspace.id, Boolean(enabled));
    revalidatePath(`/forms/${formId}/settings`);
    return { ok: true };
  } catch {
    return { ok: false, message: "Couldn't save the setting. Please try again." };
  }
}

export async function setNotificationsAction(
  formId: string,
  enabled: boolean,
): Promise<SettingsResult> {
  const ctx = await ownFormOrFail(formId);
  if (!ctx) return { ok: false, message: "Form not found." };
  try {
    await setNotificationsEnabled(ctx.supabase, formId, Boolean(enabled));
    return { ok: true };
  } catch {
    return { ok: false, message: "Couldn't save the setting. Please try again." };
  }
}

const SlugInput = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/,
    "Use 3–60 lowercase letters, numbers and hyphens, starting and ending with a letter or number.",
  );

export async function updateSlugAction(
  formId: string,
  slug: string,
): Promise<SettingsResult & { slug?: string }> {
  const parsed = SlugInput.safeParse(slug);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const ctx = await ownFormOrFail(formId);
  if (!ctx) return { ok: false, message: "Form not found." };
  try {
    await updateFormSlug(ctx.supabase, formId, ctx.workspace.id, parsed.data);
    revalidatePath(`/forms/${formId}`, "layout");
    return { ok: true, slug: parsed.data };
  } catch (error) {
    if (error instanceof SlugTakenError) {
      return { ok: false, message: "That link is already taken — try another." };
    }
    return { ok: false, message: "Couldn't change the link. Please try again." };
  }
}

/** Restores a published/archived version into the draft (P3.10). */
export async function restoreVersionAction(
  formId: string,
  versionId: string,
): Promise<SettingsResult> {
  if (!z.string().uuid().safeParse(versionId).success) {
    return { ok: false, message: "Version not found." };
  }
  const ctx = await ownFormOrFail(formId);
  if (!ctx || !canEdit(ctx.workspace.role))
    return { ok: false, message: "Form not found." };
  try {
    const { versionNumber } = await restoreVersionIntoDraft(
      ctx.supabase,
      formId,
      versionId,
    );
    const { data: auth } = await ctx.supabase.auth.getUser();
    await audit(createAdminClient(), {
      workspaceId: ctx.workspace.id,
      actorId: auth.user?.id ?? null,
      action: "form.version_restored",
      target: { type: "form", id: formId },
      metadata: { version: versionNumber },
    });
    revalidatePath(`/forms/${formId}`);
    revalidatePath(`/forms/${formId}/settings`);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof RestoreError ? error.message : "Couldn't restore it.",
    };
  }
}

/** Someone who may publish this form (A/B tests change what the live
 * link serves). */
async function publisherOrFail(formId: string) {
  const ctx = await ownFormOrFail(formId);
  if (!ctx || !canEdit(ctx.workspace.role)) return null;
  if (!(await hasPermission(ctx.supabase, ctx.workspace.id, "publish"))) return null;
  const { data: auth } = await ctx.supabase.auth.getUser();
  return auth.user ? { ...ctx, userId: auth.user.id } : null;
}

const StartTest = z.object({
  variantFormId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  split: z.number().int().min(1).max(99),
});

export async function startExperimentAction(
  formId: string,
  input: z.infer<typeof StartTest>,
): Promise<SettingsResult> {
  const parsed = StartTest.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the test's settings." };
  const ctx = await publisherOrFail(formId);
  if (!ctx) return { ok: false, message: "You don't have permission to run tests." };
  try {
    await requireFeature(ctx.supabase, ctx.workspace.id, "ab_testing");
    const id = await createExperiment(ctx.supabase, {
      workspaceId: ctx.workspace.id,
      formId,
      createdBy: ctx.userId,
      ...parsed.data,
    });
    await audit(createAdminClient(), {
      workspaceId: ctx.workspace.id,
      actorId: ctx.userId,
      action: "experiment.started",
      target: { type: "experiment", id },
      metadata: {
        form: formId,
        variant: parsed.data.variantFormId,
        split: parsed.data.split,
      },
    });
    revalidatePath(`/forms/${formId}/settings`);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof ExperimentError || error instanceof EntitlementError
          ? error.message
          : "Couldn't start the test.",
    };
  }
}

export async function stopExperimentAction(
  formId: string,
  experimentId: string,
  winner: Arm | null,
): Promise<SettingsResult & { copiedIntoDraft?: boolean }> {
  if (
    !z.string().uuid().safeParse(experimentId).success ||
    ![null, "a", "b"].includes(winner)
  )
    return { ok: false, message: "Test not found." };
  const ctx = await publisherOrFail(formId);
  if (!ctx) return { ok: false, message: "You don't have permission to stop tests." };
  try {
    const { data: test } = await ctx.supabase
      .from("experiments")
      .select("id")
      .eq("id", experimentId)
      .eq("form_id", formId)
      .maybeSingle();
    if (!test) return { ok: false, message: "Test not found." };
    const { copiedIntoDraft } = await stopExperiment(ctx.supabase, experimentId, winner);
    await audit(createAdminClient(), {
      workspaceId: ctx.workspace.id,
      actorId: ctx.userId,
      action: "experiment.stopped",
      target: { type: "experiment", id: experimentId },
      metadata: { winner },
    });
    revalidatePath(`/forms/${formId}`);
    revalidatePath(`/forms/${formId}/settings`);
    return { ok: true, copiedIntoDraft };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof ExperimentError ? error.message : "Couldn't stop the test.",
    };
  }
}
