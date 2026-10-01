/**
 * The one email layout (Part 7 §8): 600px, table-based, solid colours,
 * Arial (no web fonts) and a "bulletproof" button — a padded table cell
 * rather than a styled link alone, so it renders in Outlook too. Emails
 * always use the light palette.
 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type EmailLayoutInput = {
  /** Small pill above the title, e.g. "New response". */
  tag: string;
  tagColor: string;
  title: string;
  body: string;
  /** Label / value lines in a shaded box. */
  meta?: { label: string; value: string }[];
  button: { label: string; href: string };
  /** Small print under the button. */
  fine: string;
  /** "Sent to …" line in the footer. */
  sentTo?: string;
  /** Footer link, e.g. Notification settings. */
  footerLink?: { label: string; href: string };
  /**
   * Values already safe for HTML — used for template placeholders such as
   * Supabase's `{{ .ConfirmationURL }}`, which must not be escaped.
   */
  raw?: { buttonHref?: boolean; sentTo?: boolean };
};

const INK = "#2b2118";
const FONT = "Arial, Helvetica, sans-serif";

export function renderEmailHtml(input: EmailLayoutInput): string {
  const e = escapeHtml;
  const href = input.raw?.buttonHref ? input.button.href : e(input.button.href);
  const sentTo = input.sentTo ? (input.raw?.sentTo ? input.sentTo : e(input.sentTo)) : "";
  const meta = input.meta?.length
    ? `<tr><td style="padding:0 0 24px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5efe4;border-radius:6px;">
            <tr><td style="padding:14px 16px;font-family:${FONT};font-size:14px;line-height:1.6;color:${INK};">
              ${input.meta
                .map(
                  (m) =>
                    `<div><span style="color:#6f6254;">${e(m.label)}:</span> <strong>${e(m.value)}</strong></div>`,
                )
                .join("")}
            </td></tr>
          </table>
        </td></tr>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${e(input.title)}</title>
</head>
<body style="margin:0;padding:0;background:#f5efe4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5efe4;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
      <tr><td style="padding:0 8px 16px 8px;font-family:${FONT};font-size:18px;font-weight:bold;letter-spacing:-0.02em;color:${INK};">
        <span style="display:inline-block;width:15px;height:15px;background:#f2b233;border:1.5px solid ${INK};border-radius:4px;vertical-align:-2px;"></span>&nbsp;FormCraft
      </td></tr>
      <tr><td style="background:#fffaf1;border:1.5px solid ${INK};border-radius:10px;padding:32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="font-family:${FONT};">
            <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${input.tagColor};font-size:12px;font-weight:bold;letter-spacing:0.06em;text-transform:uppercase;color:${INK};">${e(input.tag)}</span>
          </td></tr>
          <tr><td style="padding:16px 0 10px 0;font-family:${FONT};font-size:28px;line-height:1.15;font-weight:bold;letter-spacing:-0.02em;color:${INK};">${e(input.title)}</td></tr>
          <tr><td style="padding:0 0 20px 0;font-family:${FONT};font-size:16px;line-height:1.55;color:#4a3f35;">${e(input.body)}</td></tr>
          ${meta}
          <tr><td>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr><td bgcolor="#f2b233" style="border:1.5px solid ${INK};border-radius:6px;">
                <a href="${href}" target="_blank" style="display:inline-block;padding:14px 24px;font-family:${FONT};font-size:16px;font-weight:bold;color:${INK};text-decoration:none;">${e(input.button.label)}</a>
              </td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:24px 0 0 0;font-family:${FONT};font-size:13px;line-height:1.5;color:#6f6254;">${e(input.fine)}</td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:18px 8px 0 8px;font-family:${FONT};font-size:12px;line-height:1.6;color:#6f6254;">
        ${sentTo ? `Sent to ${sentTo}.<br>` : ""}FormCraft${
          input.footerLink
            ? ` · <a href="${e(input.footerLink.href)}" style="color:#6f6254;text-decoration:underline;">${e(input.footerLink.label)}</a>`
            : ""
        }
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}
