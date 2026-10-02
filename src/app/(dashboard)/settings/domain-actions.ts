"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addDomain, DomainError, verifyDomain } from "@/domains/domains";
import { canAdmin } from "@/domains/workspaces";
import { hitRateLimit } from "@/domains/abuse/shared-rate-limit";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { createAdminClient } from "@/lib/supabase/admin";

export type DomainResult =
  { ok: true; message?: string } | { ok: false; message: string };

const Id = z.string().uuid();

async function adminContext() {
  const ctx = await getCurrentWorkspace();
  return canAdmin(ctx.workspace.role) ? ctx : null;
}

export async function addDomainAction(hostname: string): Promise<DomainResult> {
  const ctx = await adminContext();
  if (!ctx)
    return { ok: false, message: "Only the owner and admins can connect domains." };
  try {
    await addDomain(createAdminClient(), ctx.workspace.id, hostname);
    revalidatePath("/settings");
    return { ok: true, message: "Added. Now set up the DNS records below." };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, message: error.message };
    return { ok: false, message: "Couldn't add the domain. Please try again." };
  }
}

/** "Check now": looks the TXT record up straight away. */
export async function verifyDomainAction(domainId: string): Promise<DomainResult> {
  const ctx = await adminContext();
  if (!ctx || !Id.safeParse(domainId).success)
    return { ok: false, message: "Domain not found." };
  const admin = createAdminClient();
  const { data: domain } = await admin
    .from("custom_domains")
    .select("id")
    .eq("id", domainId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (!domain) return { ok: false, message: "Domain not found." };
  if (!(await hitRateLimit(admin, `domain-check:${domainId}`, 20, 3_600_000)).allowed) {
    return {
      ok: false,
      message: "Checked a lot already. DNS can take a while; try later.",
    };
  }
  const result = await verifyDomain(admin, domainId);
  revalidatePath("/settings");
  return result.status === "verified"
    ? { ok: true, message: "Verified. Your forms are live on this domain." }
    : { ok: false, message: result.lastError ?? "Not verified yet." };
}

export async function setDomainDefaultFormAction(
  domainId: string,
  formId: string | null,
): Promise<DomainResult> {
  const ctx = await adminContext();
  if (
    !ctx ||
    !Id.safeParse(domainId).success ||
    (formId !== null && !Id.safeParse(formId).success)
  ) {
    return { ok: false, message: "Domain not found." };
  }
  const { data, error } = await ctx.supabase
    .from("custom_domains")
    .update({ default_form_id: formId })
    .eq("id", domainId)
    .eq("workspace_id", ctx.workspace.id)
    .select("id");
  if (error || !data?.length) return { ok: false, message: "Couldn't save that." };
  revalidatePath("/settings");
  return { ok: true };
}

export async function removeDomainAction(domainId: string): Promise<DomainResult> {
  const ctx = await adminContext();
  if (!ctx || !Id.safeParse(domainId).success)
    return { ok: false, message: "Domain not found." };
  const { data, error } = await ctx.supabase
    .from("custom_domains")
    .delete()
    .eq("id", domainId)
    .eq("workspace_id", ctx.workspace.id)
    .select("id");
  if (error || !data?.length) return { ok: false, message: "Couldn't remove it." };
  revalidatePath("/settings");
  return { ok: true, message: "Domain removed. It no longer shows your forms." };
}
