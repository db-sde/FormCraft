"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  updatePartialResponseSettings,
  updateFormSlug,
  SlugTakenError,
} from "@/domains/forms";
import { setNotificationsEnabled } from "@/domains/notifications";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";

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
