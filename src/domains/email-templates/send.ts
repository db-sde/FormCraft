import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { ThemeV1 } from "@/domains/forms/schema/v1";
import { readEmailBranding } from "@/domains/notifications/branding";
import { renderTemplate, replyToAddress, type MergeContext } from "./render";
import type { StoredTemplate } from "./queries";

type Client = SupabaseClient<Database>;

/**
 * A custom template, rendered for one send (developer spec item 2): the
 * workspace's name in the required footer, the form theme's colour and
 * logo unless the template sets its own, and the reply-to it chose (the
 * owner's address when that isn't a valid one).
 */
export async function renderForSend(
  admin: Client,
  input: {
    workspaceId: string;
    stored: StoredTemplate;
    merge: MergeContext;
    theme?: Pick<ThemeV1, "primaryColor" | "logoUrl">;
    footerReason: string;
  },
): Promise<{
  subject: string;
  html: string;
  text: string;
  fromName?: string;
  replyTo?: string;
}> {
  const { data: ws } = await admin
    .from("workspaces")
    .select("name, email_branding, owner:profiles!workspaces_owner_id_fkey(email)")
    .eq("id", input.workspaceId)
    .maybeSingle();
  const branding = readEmailBranding(ws?.email_branding);
  const ownerEmail = (ws?.owner as { email: string | null } | null)?.email ?? null;
  const rendered = renderTemplate(input.stored.template, input.merge, {
    accent: branding.accentColor ?? input.theme?.primaryColor ?? "#f2b233",
    logoUrl: input.theme?.logoUrl ?? branding.logoUrl,
    ownerName: ws?.name ?? "the form's owner",
    footerReason: input.footerReason,
  });
  const fromName = (input.stored.template.senderName || branding.fromName || "")
    .replace(/[\r\n]+/g, " ")
    .trim();
  return {
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    fromName: fromName || undefined,
    replyTo: replyToAddress(input.stored.template, input.merge, ownerEmail) ?? undefined,
  };
}
