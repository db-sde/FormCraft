import "server-only";
import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { takeQuota } from "@/domains/billing/quotas";
import { getNotificationsEnabled } from "./queries";
import { workspaceEmailBrand } from "./branding";
import { fromHeader } from "./mailer";
import { buildResponseCompletedEmail } from "./template";

type Client = SupabaseClient<Database>;

export type NotificationResult =
  | { sent: true }
  | {
      sent: false;
      reason: "disabled" | "no_api_key" | "no_owner_email" | "send_failed" | "deferred";
    };

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

    // The month's emails are used: counted for the owner's daily summary
    // instead (pricing doc: "switch to the daily digest").
    if (!(await takeQuota(admin, form.workspace_id, "emails"))) {
      await admin.rpc("ops_defer_notification", {
        p_workspace_id: form.workspace_id,
        p_form_id: formId,
      });
      return { sent: false, reason: "deferred" };
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const { brand, fromName } = await workspaceEmailBrand(admin, form.workspace_id);
    const email = buildResponseCompletedEmail({
      brand,
      formTitle: form.title,
      submittedAt: new Date().toISOString(),
      dashboardUrl: `${appUrl}/forms/${formId}/responses/${responseId}`,
      settingsUrl: `${appUrl}/forms/${formId}/integrations`,
      recipient: ownerEmail,
    });

    const resend = new Resend(apiKey);
    const { error: sendError } = await resend.emails.send({
      from: fromHeader(fromName),
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
