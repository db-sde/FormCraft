"use server";

import { recordAudit } from "@/domains/audit/record";

import { getDraftForEdit, saveDraftSchema, StaleDraftError } from "@/domains/forms";
import { VariantV1 } from "@/domains/forms/schema/v1";
import { parseFormSchema } from "@/domains/forms/schema";
import { applyVariant, ORIGINAL, variantProblems } from "@/domains/forms/variants";
import { ConfidentialSettings } from "@/domains/responses/feedback-report";

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
import { KioskConfig, KIOSK_PIN_PATTERN, setKioskPin } from "@/domains/forms/kiosk";

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
    await recordAudit({
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
    await recordAudit({
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
    await recordAudit({
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
    await recordAudit({
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
    await recordAudit({
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
    await recordAudit({
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

// --- Kiosk mode (master spec F-15) ---------------------------------------

/** Turns kiosk mode on with these timings, or off (null). */
export async function updateKioskAction(
  formId: string,
  config: { resetSeconds: number; idleSeconds: number } | null,
): Promise<SettingsResult> {
  const parsed = config === null ? null : KioskConfig.safeParse(config);
  if (parsed && !parsed.success) {
    return {
      ok: false,
      message: "Start over after 3–60 seconds, and ask “Still there?” after 30–900.",
    };
  }
  const ctx = await publisherOrFail(formId);
  if (!ctx) return { ok: false, message: "You don't have permission to change this." };
  try {
    const { error } = await ctx.supabase
      .from("forms")
      .update({ kiosk_config: parsed ? parsed.data : null })
      .eq("id", formId)
      .eq("workspace_id", ctx.workspace.id);
    if (error) throw error;
    await recordAudit({
      workspaceId: ctx.workspace.id,
      actorId: ctx.userId,
      action: "form.kiosk_changed",
      target: { type: "form", id: formId },
      metadata: { enabled: parsed !== null },
    });
    revalidatePath(`/forms/${formId}/settings`);
    return { ok: true };
  } catch {
    return { ok: false, message: "Couldn't save the setting. Please try again." };
  }
}

/** Sets (4–8 digits) or removes (null) the PIN for leaving kiosk mode. */
export async function setKioskPinAction(
  formId: string,
  pin: string | null,
): Promise<SettingsResult> {
  if (pin !== null && !KIOSK_PIN_PATTERN.test(pin)) {
    return { ok: false, message: "Use 4 to 8 digits." };
  }
  const ctx = await publisherOrFail(formId);
  if (!ctx) return { ok: false, message: "You don't have permission to change this." };
  try {
    await setKioskPin(createAdminClient(), formId, pin);
    await recordAudit({
      workspaceId: ctx.workspace.id,
      actorId: ctx.userId,
      action: "form.kiosk_changed",
      target: { type: "form", id: formId },
      metadata: { pin: pin !== null },
    });
    revalidatePath(`/forms/${formId}/settings`);
    return { ok: true };
  } catch {
    return { ok: false, message: "Couldn't save the PIN. Please try again." };
  }
}

// --- In-form variants (master spec F-29) ---------------------------------
// The variant lives in the draft (published with the form); a test sends a
// share of new visitors to it. Same rights as publishing.

/** Saves the form's variant into the draft (null removes it). */
export async function saveVariantAction(
  formId: string,
  variant: VariantV1 | null,
): Promise<SettingsResult> {
  if (variant !== null && !VariantV1.safeParse(variant).success) {
    return { ok: false, message: "Check the variant." };
  }
  const ctx = await publisherOrFail(formId);
  if (!ctx) return { ok: false, message: "You don't have permission to run tests." };
  const draft = await getDraftForEdit(ctx.supabase, formId, ctx.workspace.id);
  if (!draft) return { ok: false, message: "Form not found." };
  const schema = { ...draft.schema, variants: variant ? [variant] : undefined };
  const problems = variantProblems(schema);
  if (problems.length) return { ok: false, message: problems[0] };
  try {
    await saveDraftSchema(ctx.supabase, draft.draftVersionId, draft.revision, schema);
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof StaleDraftError
          ? "The form changed in another tab. Reload and try again."
          : "Couldn't save the variant.",
    };
  }
  revalidatePath(`/forms/${formId}/settings`);
  return { ok: true };
}

const VariantTestInput = z.object({
  variantId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  name: z.string().trim().min(1).max(120),
  split: z.number().int().min(1).max(99),
});

/** Starts a test of the published variant against the original. */
export async function startVariantTestAction(
  formId: string,
  input: z.infer<typeof VariantTestInput>,
): Promise<SettingsResult> {
  const parsed = VariantTestInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the test's settings." };
  const ctx = await publisherOrFail(formId);
  if (!ctx) return { ok: false, message: "You don't have permission to run tests." };
  try {
    await requireFeature(ctx.supabase, ctx.workspace.id, "ab_testing");
  } catch (error) {
    return {
      ok: false,
      message: error instanceof EntitlementError ? error.message : "Not allowed.",
    };
  }
  const { data: live } = await ctx.supabase
    .from("form_versions")
    .select("schema")
    .eq("form_id", formId)
    .eq("status", "published")
    .maybeSingle();
  const published = live ? parseFormSchema(live.schema) : null;
  if (!published?.variants?.some((v) => v.id === parsed.data.variantId)) {
    return { ok: false, message: "Publish the form with this variant first." };
  }
  const { data, error } = await ctx.supabase
    .from("variant_tests")
    .insert({
      form_id: formId,
      variant_id: parsed.data.variantId,
      name: parsed.data.name,
      split: parsed.data.split,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    return {
      ok: false,
      message:
        error?.code === "23505"
          ? "This form already has a test."
          : "Couldn't start the test.",
    };
  }
  await recordAudit({
    workspaceId: ctx.workspace.id,
    actorId: ctx.userId,
    action: "experiment.started",
    target: { type: "variant_test", id: data.id },
    metadata: { form: formId, variant: parsed.data.variantId, split: parsed.data.split },
  });
  revalidatePath(`/forms/${formId}/settings`);
  return { ok: true };
}

/** Pauses or resumes a test; the split changes only while paused. */
export async function updateVariantTestAction(
  formId: string,
  testId: string,
  change: { status?: "running" | "paused"; split?: number },
): Promise<SettingsResult> {
  if (
    !z.string().uuid().safeParse(testId).success ||
    (change.status && !["running", "paused"].includes(change.status)) ||
    (change.split !== undefined &&
      !z.number().int().min(1).max(99).safeParse(change.split).success)
  ) {
    return { ok: false, message: "Check the test's settings." };
  }
  const ctx = await publisherOrFail(formId);
  if (!ctx) return { ok: false, message: "You don't have permission to run tests." };
  const { data, error } = await ctx.supabase
    .from("variant_tests")
    .update({
      ...(change.status ? { status: change.status } : {}),
      ...(change.split !== undefined ? { split: change.split } : {}),
    })
    .eq("id", testId)
    .eq("form_id", formId)
    .select("id");
  if (error) {
    return {
      ok: false,
      message: error.message.includes("Pause the test")
        ? "Pause the test to change its split."
        : "Couldn't change the test.",
    };
  }
  if (!data?.length) return { ok: false, message: "Test not found." };
  revalidatePath(`/forms/${formId}/settings`);
  return { ok: true };
}

/**
 * Ends a test, optionally adopting a winner. Adopting the variant writes
 * its wording, order and layout into the draft (and drops the variant);
 * nothing is published — the creator reviews and publishes. Responses
 * already collected keep the version they answered.
 */
export async function endVariantTestAction(
  formId: string,
  testId: string,
  winner: string | null,
): Promise<SettingsResult & { copiedIntoDraft?: boolean }> {
  if (!z.string().uuid().safeParse(testId).success)
    return { ok: false, message: "Test not found." };
  const ctx = await publisherOrFail(formId);
  if (!ctx) return { ok: false, message: "You don't have permission to run tests." };
  const { data: test } = await ctx.supabase
    .from("variant_tests")
    .select("variant_id, status")
    .eq("id", testId)
    .eq("form_id", formId)
    .maybeSingle();
  if (!test || test.status === "ended") return { ok: false, message: "Test not found." };
  if (winner !== null && winner !== ORIGINAL && winner !== test.variant_id) {
    return { ok: false, message: "Pick the original or the variant." };
  }
  let copiedIntoDraft = false;
  if (winner === test.variant_id) {
    const draft = await getDraftForEdit(ctx.supabase, formId, ctx.workspace.id);
    if (!draft) return { ok: false, message: "Form not found." };
    if (draft.schema.variants?.some((v) => v.id === winner)) {
      const adopted = { ...applyVariant(draft.schema, winner), variants: undefined };
      try {
        await saveDraftSchema(
          ctx.supabase,
          draft.draftVersionId,
          draft.revision,
          adopted,
        );
        copiedIntoDraft = true;
      } catch {
        return {
          ok: false,
          message: "Couldn't copy the variant into the draft. Reload and try again.",
        };
      }
    }
  }
  const { error } = await ctx.supabase
    .from("variant_tests")
    .update({ status: "ended", winner })
    .eq("id", testId);
  if (error) return { ok: false, message: "Couldn't end the test." };
  await recordAudit({
    workspaceId: ctx.workspace.id,
    actorId: ctx.userId,
    action: "experiment.stopped",
    target: { type: "variant_test", id: testId },
    metadata: { winner },
  });
  revalidatePath(`/forms/${formId}`);
  revalidatePath(`/forms/${formId}/settings`);
  return { ok: true, copiedIntoDraft };
}

// --- Confidential feedback (master spec F-30) -----------------------------

/**
 * Makes the form's responses confidential (360 feedback) or changes its
 * settings. Once a confidential form has responses it stays confidential
 * and its threshold can't go down — the database refuses it.
 */
export async function setConfidentialAction(
  formId: string,
  settings: { threshold: number; groupQuestionId?: string } | null,
): Promise<SettingsResult> {
  if (settings !== null && !ConfidentialSettings.safeParse(settings).success) {
    return { ok: false, message: "The threshold must be between 2 and 50." };
  }
  const ctx = await publisherOrFail(formId);
  if (!ctx) return { ok: false, message: "You don't have permission to change this." };
  const { error } = await ctx.supabase
    .from("forms")
    .update({ confidential: settings })
    .eq("id", formId)
    .eq("workspace_id", ctx.workspace.id);
  if (error) {
    return {
      ok: false,
      message: error.message.includes("stays confidential")
        ? "This form has responses, so it stays confidential and its threshold can't go down."
        : "Couldn't save that.",
    };
  }
  revalidatePath(`/forms/${formId}`, "layout");
  return { ok: true };
}
