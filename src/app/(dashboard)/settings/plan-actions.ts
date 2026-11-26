"use server";

import { z } from "zod";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { canAdmin } from "@/domains/workspaces";

/** Asks FormCraft staff to move this workspace to a plan (owners and
 * admins). The database checks the role and the plan again, and tells
 * staff by alert; they change the plan through an approved request. */
export async function requestUpgradeAction(
  planId: string,
  note: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const parsed = z
    .object({
      planId: z.enum(["starter", "pro", "business"]),
      note: z.string().max(1000),
    })
    .safeParse({ planId, note });
  if (!parsed.success) return { ok: false, message: "Choose a plan." };
  const { supabase, workspace } = await getCurrentWorkspace();
  if (!canAdmin(workspace.role))
    return { ok: false, message: "Only the owner and admins can change the plan." };
  const { data, error } = await supabase.rpc("request_plan_upgrade", {
    p_workspace_id: workspace.id,
    p_plan_id: parsed.data.planId,
    p_note: parsed.data.note,
  });
  const result = data as { ok: boolean; code?: string } | null;
  if (error || !result) return { ok: false, message: "Couldn't send it. Try again." };
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.code === "already_requested"
          ? "You asked in the last day. We'll be in touch soon."
          : "Couldn't send it. Try again.",
    };
  }
  return { ok: true };
}

/** Email branding (Starter and up): colour, logo, footer and sender name
 * on respondent, owner, rule and booking emails. Owners and admins. */
export async function saveEmailBrandingAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { EmailBranding } = await import("@/domains/notifications/branding");
  const { isOwnUpload } = await import("@/domains/forms/seo");
  const { planBlocks } = await import("@/domains/billing/entitlements");
  const parsed = EmailBranding.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        "Use a colour like #e05d36, a footer under 300 characters and a sender name under 60 (no < > @ , ;).",
    };
  }
  const { supabase, workspace } = await getCurrentWorkspace();
  if (!canAdmin(workspace.role))
    return { ok: false, message: "Only the owner and admins can change this." };
  const branding = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined && v !== ""),
  );
  if (Object.keys(branding).length > 0) {
    const blocked = await planBlocks(supabase, workspace.id, "email_templates");
    if (blocked) return { ok: false, message: blocked };
  }
  if (parsed.data.logoUrl && !isOwnUpload(parsed.data.logoUrl, workspace.id)) {
    return {
      ok: false,
      message: "Upload the logo here rather than linking to another site.",
    };
  }
  const { error } = await supabase
    .from("workspaces")
    .update({ email_branding: branding })
    .eq("id", workspace.id);
  if (error) return { ok: false, message: "Couldn't save that." };
  return { ok: true };
}
