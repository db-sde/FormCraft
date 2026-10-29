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
import {
  MAX_MESSAGE_LENGTH,
  MAX_RESPONSE_CAP,
  setCaptchaRequired,
  updateAvailabilitySettings,
} from "@/domains/forms/availability";
import { setFormPassword } from "@/domains/forms/access";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/domains/forms/access-rules";
import { isTurnstileConfigured } from "@/domains/abuse/turnstile";

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

// --- Who can respond (master spec F-26, F-46, F-47, F-48) ---------------
// Closing a form, capping it, locking it and requiring a CAPTCHA all
// change who can submit to the live link, so they need the same rights
// as publishing, and each change is audited.

const AvailabilityInput = z.object({
  closesAt: z.string().datetime({ offset: true }).nullable(),
  closedMessage: z.string().max(MAX_MESSAGE_LENGTH).nullable(),
  responseCap: z.number().int().min(1).max(MAX_RESPONSE_CAP).nullable(),
  fullMessage: z.string().max(MAX_MESSAGE_LENGTH).nullable(),
});

export async function updateAvailabilityAction(
  formId: string,
  input: z.infer<typeof AvailabilityInput>,
): Promise<SettingsResult> {
  const parsed = AvailabilityInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: `Check the date, a limit between 1 and ${MAX_RESPONSE_CAP.toLocaleString("en-US")}, and messages under ${MAX_MESSAGE_LENGTH} characters.`,
    };
  }
  const ctx = await publisherOrFail(formId);
  if (!ctx) return { ok: false, message: "You don't have permission to change this." };
  try {
    const closesAt = parsed.data.closesAt
      ? new Date(parsed.data.closesAt).toISOString()
      : null;
    await updateAvailabilitySettings(ctx.supabase, formId, ctx.workspace.id, {
      ...parsed.data,
      closesAt,
    });
    await audit(createAdminClient(), {
      workspaceId: ctx.workspace.id,
      actorId: ctx.userId,
      action: "form.availability_changed",
      target: { type: "form", id: formId },
      metadata: { closes_at: closesAt, response_cap: parsed.data.responseCap },
    });
    revalidatePath(`/forms/${formId}/settings`);
    return { ok: true };
  } catch {
    return { ok: false, message: "Couldn't save the setting. Please try again." };
  }
}

const PasswordInput = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`)
  .nullable();

/** Sets or changes the form's password (null removes it). Everyone who
 * unlocked it with the old password has to enter the new one. */
export async function setFormPasswordAction(
  formId: string,
  password: string | null,
): Promise<SettingsResult> {
  const parsed = PasswordInput.safeParse(password);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const ctx = await publisherOrFail(formId);
  if (!ctx) return { ok: false, message: "You don't have permission to change this." };
  try {
    // The hash table is server-only; the permission check above is what
    // stands in for row-level security here.
    await setFormPassword(createAdminClient(), formId, parsed.data);
    await audit(createAdminClient(), {
      workspaceId: ctx.workspace.id,
      actorId: ctx.userId,
      action: parsed.data === null ? "form.password_removed" : "form.password_set",
      target: { type: "form", id: formId },
    });
    revalidatePath(`/forms/${formId}/settings`);
    return { ok: true };
  } catch {
    return { ok: false, message: "Couldn't save the password. Please try again." };
  }
}

export async function setCaptchaAction(
  formId: string,
  required: boolean,
): Promise<SettingsResult> {
  if (required && !isTurnstileConfigured()) {
    return {
      ok: false,
      message: "The CAPTCHA service isn't set up on this server yet.",
    };
  }
  const ctx = await publisherOrFail(formId);
  if (!ctx) return { ok: false, message: "You don't have permission to change this." };
  try {
    await setCaptchaRequired(ctx.supabase, formId, ctx.workspace.id, Boolean(required));
    await audit(createAdminClient(), {
      workspaceId: ctx.workspace.id,
      actorId: ctx.userId,
      action: "form.captcha_changed",
      target: { type: "form", id: formId },
      metadata: { required: Boolean(required) },
    });
    revalidatePath(`/forms/${formId}/settings`);
    return { ok: true };
  } catch {
    return { ok: false, message: "Couldn't save the setting. Please try again." };
  }
}
