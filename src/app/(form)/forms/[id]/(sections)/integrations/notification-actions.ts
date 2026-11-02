"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { canEdit } from "@/domains/workspaces";
import { assignableMembers } from "@/domains/responses/records";
import { NotificationRuleInput } from "@/domains/notifications/rules";
import { isValidTimeZone } from "@/domains/logic/datetime";
import type { Json } from "@/lib/supabase/database.types";

type Result = { ok: true; id?: string } | { ok: false; message: string };

async function editable(formId: string) {
  const { supabase, workspace } = await getCurrentWorkspace();
  if (!canEdit(workspace.role)) return null;
  const { data: form } = await supabase
    .from("forms")
    .select("id")
    .eq("id", formId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  return form ? { supabase, workspace } : null;
}

async function onlyTeammates(
  ctx: NonNullable<Awaited<ReturnType<typeof editable>>>,
  memberIds: string[],
) {
  const allowed = new Set(
    (await assignableMembers(ctx.supabase, ctx.workspace.id)).map((m) => m.id),
  );
  return memberIds.every((id) => allowed.has(id));
}

/** Creates or updates a notification rule (F-25). Recipients must be
 * teammates who can see responses. */
export async function saveNotificationRuleAction(
  formId: string,
  ruleId: string | null,
  input: z.input<typeof NotificationRuleInput>,
): Promise<Result> {
  const parsed = NotificationRuleInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the fields." };
  }
  const ctx = await editable(formId);
  if (!ctx)
    return { ok: false, message: "You don't have permission to change this form." };
  if (!(await onlyTeammates(ctx, parsed.data.memberIds))) {
    return { ok: false, message: "Recipients must be teammates who can see responses." };
  }
  const row = {
    form_id: formId,
    name: parsed.data.name,
    enabled: parsed.data.enabled,
    member_ids: parsed.data.memberIds,
    condition: (parsed.data.condition ?? null) as Json,
    subject: parsed.data.subject?.trim() || null,
    include_answers: parsed.data.includeAnswers,
    attach_document: parsed.data.attachDocument ?? null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = ruleId
    ? await ctx.supabase
        .from("notification_rules")
        .update(row)
        .eq("id", ruleId)
        .eq("form_id", formId)
        .select("id")
    : await ctx.supabase.from("notification_rules").insert(row).select("id");
  if (error || !data?.length)
    return { ok: false, message: "Couldn't save. Please try again." };
  revalidatePath(`/forms/${formId}/integrations`);
  return { ok: true, id: data[0].id };
}

export async function deleteNotificationRuleAction(
  formId: string,
  ruleId: string,
): Promise<Result> {
  const ctx = await editable(formId);
  if (!ctx)
    return { ok: false, message: "You don't have permission to change this form." };
  const { error } = await ctx.supabase
    .from("notification_rules")
    .delete()
    .eq("id", ruleId)
    .eq("form_id", formId);
  if (error) return { ok: false, message: "Couldn't delete it. Please try again." };
  revalidatePath(`/forms/${formId}/integrations`);
  return { ok: true };
}

const DigestInput = z.object({
  enabled: z.boolean(),
  memberIds: z.array(z.string().uuid()).max(20),
  timeZone: z.string().min(1).max(64),
  frequency: z.enum(["daily", "weekly"]).default("daily"),
});

/** The daily digest (F-25). Turning it off keeps the settings. */
export async function saveDigestAction(
  formId: string,
  input: z.input<typeof DigestInput>,
): Promise<Result> {
  const parsed = DigestInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the fields." };
  if (!isValidTimeZone(parsed.data.timeZone)) {
    return { ok: false, message: "Pick a time zone from the list, like Asia/Kolkata." };
  }
  if (parsed.data.enabled && parsed.data.memberIds.length === 0) {
    return { ok: false, message: "Choose at least one teammate." };
  }
  const ctx = await editable(formId);
  if (!ctx)
    return { ok: false, message: "You don't have permission to change this form." };
  if (!(await onlyTeammates(ctx, parsed.data.memberIds))) {
    return { ok: false, message: "Recipients must be teammates who can see responses." };
  }
  if (parsed.data.memberIds.length === 0) {
    await ctx.supabase.from("notification_digests").delete().eq("form_id", formId);
  } else {
    const { error } = await ctx.supabase.from("notification_digests").upsert(
      {
        form_id: formId,
        enabled: parsed.data.enabled,
        member_ids: parsed.data.memberIds,
        time_zone: parsed.data.timeZone,
        frequency: parsed.data.frequency,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "form_id" },
    );
    if (error) return { ok: false, message: "Couldn't save. Please try again." };
  }
  revalidatePath(`/forms/${formId}/integrations`);
  return { ok: true };
}
