import "server-only";
import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getNotificationsEnabled } from "./queries";
import { buildResponseCompletedEmail } from "./template";

type Client = SupabaseClient<Database>;

export type NotificationResult =
  | { sent: true }
  | { sent: false; reason: "disabled" | "no_api_key" | "no_owner_email" | "send_failed" };

/**
 * Notifies a form's owner that a response just completed. Called from
 * the /complete route handler *after* the canonical response write has
 * already succeeded — this function's own failure (missing API key,
 * Resend outage, whatever) must never be allowed to affect the
 * respondent-facing result, which is why it swallows every error
 * internally and returns a result instead of throwing (see
 * ARCHITECTURE.md: integrations are async side effects, never the
 * source of truth for response durability).
 */
export async function notifyFormOwnerOfCompletedResponse(
  admin: Client,
  formId: string,
  responseId: string,
): Promise<NotificationResult> {
  try {
    const enabled = await getNotificationsEnabled(admin, formId);
    if (!enabled) return { sent: false, reason: "disabled" };

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return { sent: false, reason: "no_api_key" };

    const { data: form, error: formError } = await admin
      .from("forms")
      .select("title, workspace_id")
      .eq("id", formId)
      .single();
    if (formError || !form) return { sent: false, reason: "no_owner_email" };

    const { data: workspace, error: workspaceError } = await admin
      .from("workspaces")
      .select("owner_id")
      .eq("id", form.workspace_id)
      .single();
    if (workspaceError || !workspace) return { sent: false, reason: "no_owner_email" };

    const { data: owner, error: ownerError } = await admin
      .from("profiles")
      .select("email")
      .eq("id", workspace.owner_id)
      .single();
    if (ownerError || !owner?.email) return { sent: false, reason: "no_owner_email" };

    const ownerEmail = owner.email;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const email = buildResponseCompletedEmail({
      formTitle: form.title,
      submittedAt: new Date().toISOString(),
      dashboardUrl: `${appUrl}/forms/${formId}/responses/${responseId}`,
    });

    const resend = new Resend(apiKey);
    const { error: sendError } = await resend.emails.send({
      from: process.env.EMAIL_FROM ?? "FormCraft <notifications@formcraft.local>",
      to: ownerEmail,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    if (sendError) return { sent: false, reason: "send_failed" };

    return { sent: true };
  } catch {
    return { sent: false, reason: "send_failed" };
  }
}
