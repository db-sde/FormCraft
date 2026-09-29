/** Escapes text for safe interpolation into the HTML email body — form
 * titles and ending titles are creator-supplied free text, not
 * hard-coded strings, so this is a real XSS-in-email guard, not
 * defensive boilerplate. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type ResponseCompletedEmailInput = {
  formTitle: string;
  submittedAt: string;
  dashboardUrl: string;
};

export type EmailContent = { subject: string; html: string; text: string };

/** The one notification Phase 1 sends: a completed-response alert to
 * the form's owner. Links to the dashboard rather than embedding raw
 * answers in the email body — see ARCHITECTURE.md/docs on not sending
 * sensitive respondent content into places outside the canonical
 * response store. */
export function buildResponseCompletedEmail(
  input: ResponseCompletedEmailInput,
): EmailContent {
  const formTitle = escapeHtml(input.formTitle || "Untitled form");
  // Sent from the server, which doesn't know the recipient's timezone —
  // label the zone explicitly rather than implying local time.
  const submitted = `${new Date(input.submittedAt).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  })} UTC`;

  const subject = `New response: ${input.formTitle || "Untitled form"}`;

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="margin-bottom: 4px;">New response received</h2>
      <p style="color: #555; margin-top: 0;">${formTitle} — ${submitted}</p>
      <a href="${input.dashboardUrl}"
         style="display: inline-block; margin-top: 16px; padding: 10px 20px; background: #0f172a; color: #fff; text-decoration: none; border-radius: 6px;">
        View response
      </a>
    </div>
  `.trim();

  const text = `New response for "${input.formTitle || "Untitled form"}" at ${submitted}.\n\nView it: ${input.dashboardUrl}`;

  return { subject, html, text };
}
