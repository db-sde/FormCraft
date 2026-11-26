import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getWorkspacePlan } from "@/domains/billing/entitlements";
import type { EmailBrand } from "./email-layout";

type Client = SupabaseClient<Database>;

/**
 * Email branding (pricing doc: custom email templates, Starter and up):
 * the workspace's accent colour, logo, footer and sender name on the
 * emails respondents and the team get (confirmations, owner notifications,
 * rule emails, booking emails). The wording of each email is set where it
 * always was (the confirmation's and each rule's own settings). On a plan
 * without it, emails use FormCraft's look.
 */
export const EmailBranding = z.object({
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  logoUrl: z.string().url().max(500).optional(),
  footer: z.string().trim().max(300).optional(),
  /** Shown as the sender's name; the address stays FormCraft's. */
  fromName: z
    .string()
    .trim()
    .max(60)
    .regex(/^[^<>"@,;\r\n]*$/)
    .optional(),
});
export type EmailBranding = z.infer<typeof EmailBranding>;

export function readEmailBranding(value: unknown): EmailBranding {
  const parsed = EmailBranding.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

/** The brand to put on this workspace's emails, if its plan includes it. */
export async function workspaceEmailBrand(
  admin: Client,
  workspaceId: string,
): Promise<{ brand?: EmailBrand; fromName?: string }> {
  try {
    const { entitlements } = await getWorkspacePlan(admin, workspaceId);
    if (!entitlements.email_templates) return {};
    const { data } = await admin
      .from("workspaces")
      .select("name, email_branding")
      .eq("id", workspaceId)
      .maybeSingle();
    if (!data) return {};
    const b = readEmailBranding(data.email_branding);
    if (!b.accentColor && !b.logoUrl && !b.footer && !b.fromName) return {};
    return {
      brand: {
        name: b.fromName || data.name,
        logoUrl: b.logoUrl,
        accent: b.accentColor,
        footer: b.footer,
      },
      fromName: b.fromName,
    };
  } catch {
    return {};
  }
}
