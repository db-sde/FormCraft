import { renderEmailHtml } from "./email-layout";

export type ResponseCompletedEmailInput = {
  formTitle: string;
  submittedAt: string;
  dashboardUrl: string;
  /** Where the owner turns these emails off (the form's Integrations). */
  settingsUrl?: string;
  /** The address it's sent to, shown in the footer. */
  recipient?: string;
};

export type EmailContent = { subject: string; html: string; text: string };

/** The one notification Phase 1 sends: a completed-response alert to
 * the form's owner. Links to the dashboard rather than embedding raw
 * answers in the email body — see ARCHITECTURE.md/docs on not sending
 * sensitive respondent content into places outside the canonical
 * response store. Creator-supplied text (the form title) is escaped by
 * the layout, so it can't inject markup into the email. */
export function buildResponseCompletedEmail(
  input: ResponseCompletedEmailInput,
): EmailContent {
  const formTitle = input.formTitle || "Untitled form";
  // Sent from the server, which doesn't know the recipient's timezone —
  // label the zone explicitly rather than implying local time.
  const date = new Date(input.submittedAt);
  const received = `${date.toLocaleDateString("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  })} · ${date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  })} UTC`;

  const subject = `New response: ${formTitle}`;
  const body =
    "Someone just finished your form. We keep answers out of email, so open FormCraft to read them.";
  const fine =
    "You're getting this because you own this form. Change it in Integrations → Email notifications.";

  const html = renderEmailHtml({
    tag: "New response",
    tagColor: "#dcf1e3",
    title: "New response received",
    body,
    meta: [
      { label: "Form", value: formTitle },
      { label: "Received", value: received },
    ],
    button: { label: "View response", href: input.dashboardUrl },
    fine,
    sentTo: input.recipient,
    footerLink: input.settingsUrl
      ? { label: "Notification settings", href: input.settingsUrl }
      : undefined,
  });

  const text = [
    "FormCraft",
    "",
    "NEW RESPONSE RECEIVED",
    "",
    body,
    "",
    `Form:     ${formTitle}`,
    `Received: ${received}`,
    "",
    "View response:",
    input.dashboardUrl,
    "",
    "—",
    "You're getting this because you own this form.",
    ...(input.settingsUrl ? [`Change it: ${input.settingsUrl}`] : []),
  ].join("\n");

  return { subject, html, text };
}
