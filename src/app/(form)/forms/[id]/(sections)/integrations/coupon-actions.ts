"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { EntitlementError, requireFeature } from "@/domains/billing";
import { canEdit } from "@/domains/workspaces";
import { hasPermission } from "@/domains/workspaces/permissions";
import { CouponInput } from "@/domains/payments/coupons";
import { minorUnits, readPaymentConfig } from "@/domains/payments/config";
import type { Json } from "@/lib/supabase/database.types";

type Result = { ok: true; id?: string } | { ok: false; message: string };

/** Editors who manage integrations, on a plan with payments. */
async function couponEditor(formId: string) {
  const { supabase, workspace, user } = await getCurrentWorkspace();
  if (!canEdit(workspace.role)) return { error: "You have view-only access." } as const;
  if (!(await hasPermission(supabase, workspace.id, "manage_integrations")))
    return { error: "You don't have permission to manage payments." } as const;
  try {
    await requireFeature(supabase, workspace.id, "payments");
  } catch (error) {
    if (error instanceof EntitlementError) return { error: error.message } as const;
    throw error;
  }
  const { data: form } = await supabase
    .from("forms")
    .select("id, payment_config")
    .eq("id", formId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!form) return { error: "Form not found." } as const;
  return {
    supabase,
    user,
    config: readPaymentConfig(form.payment_config as Json),
  } as const;
}

/** Creates or updates a coupon (F-22). An amount off is in the form's
 * payment currency. Uses are counted by the server, never set here. */
export async function saveCouponAction(
  formId: string,
  couponId: string | null,
  input: z.input<typeof CouponInput>,
): Promise<Result> {
  const parsed = CouponInput.safeParse(input);
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the coupon." };
  if (couponId && !z.string().uuid().safeParse(couponId).success)
    return { ok: false, message: "Coupon not found." };
  const ctx = await couponEditor(formId);
  if ("error" in ctx) return { ok: false, message: ctx.error ?? "Not allowed." };
  if (!ctx.config)
    return { ok: false, message: "Turn on payment for this form before adding coupons." };
  const c = parsed.data;
  const row = {
    form_id: formId,
    code: c.code,
    kind: c.kind,
    percent_off: c.kind === "percent" ? c.value : null,
    amount_off:
      c.kind === "amount" ? Math.round(c.value * minorUnits(ctx.config.currency)) : null,
    expires_at: c.expiresAt,
    max_uses: c.maxUses,
    active: c.active,
  };
  const { data, error } = couponId
    ? await ctx.supabase
        .from("coupons")
        .update(row)
        .eq("id", couponId)
        .eq("form_id", formId)
        .select("id")
    : await ctx.supabase
        .from("coupons")
        .insert({ ...row, created_by: ctx.user.id })
        .select("id");
  if (error?.code === "23505")
    return { ok: false, message: "This form already has a coupon with that code." };
  if (error || !data?.length)
    return { ok: false, message: "Couldn't save the coupon. Please try again." };
  revalidatePath(`/forms/${formId}/integrations`);
  return { ok: true, id: data[0].id };
}

/** Deletes a coupon. Payments that used it keep its code. */
export async function deleteCouponAction(
  formId: string,
  couponId: string,
): Promise<Result> {
  if (!z.string().uuid().safeParse(couponId).success)
    return { ok: false, message: "Coupon not found." };
  const ctx = await couponEditor(formId);
  if ("error" in ctx) return { ok: false, message: ctx.error ?? "Not allowed." };
  const { error } = await ctx.supabase
    .from("coupons")
    .delete()
    .eq("id", couponId)
    .eq("form_id", formId);
  if (error) return { ok: false, message: "Couldn't delete it. Please try again." };
  revalidatePath(`/forms/${formId}/integrations`);
  return { ok: true };
}
