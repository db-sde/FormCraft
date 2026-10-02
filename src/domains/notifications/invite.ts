import "server-only";
import { Resend } from "resend";
import { renderEmailHtml } from "./email-layout";

/**
 * The workspace invitation email (P2.19). Best effort: returns false
 * when email isn't configured or sending fails, and the inviter is
 * given the link to share instead.
 */
export async function sendInvitationEmail(input: {
  to: string;
  workspaceName: string;
  inviterName: string;
  role: string;
  link: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const subject = `${input.inviterName || "Someone"} invited you to ${input.workspaceName} on FormCraft`;
  const body = `You've been invited to join ${input.workspaceName} as ${
    input.role === "admin" ? "an admin" : `a ${input.role}`
  }.`;
  try {
    const { error } = await new Resend(apiKey).emails.send({
      from: process.env.EMAIL_FROM ?? "FormCraft <notifications@formcraft.local>",
      to: input.to,
      subject,
      html: renderEmailHtml({
        tag: "Invitation",
        tagColor: "#f5c04a",
        title: `Join ${input.workspaceName}`,
        body,
        button: { label: "Accept invitation", href: input.link },
        fine: "The link works for 7 days, for this email address only.",
        sentTo: input.to,
      }),
      text: `${body}\n\nAccept: ${input.link}\n\nThe link works for 7 days, for this email address only.`,
    });
    return !error;
  } catch {
    return false;
  }
}
