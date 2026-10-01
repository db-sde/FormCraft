/**
 * Writes Supabase's auth email templates (confirm sign-up, reset
 * password) from the shared email layout, so they match the app's own
 * emails. Run `npm run emails:build` after changing the layout, then
 * paste the files into the hosted project's Auth → Email Templates
 * (local Supabase reads them via supabase/config.toml).
 */
import { writeFileSync } from "node:fs";
import { renderEmailHtml } from "../src/domains/notifications/email-layout";

const templates = [
  {
    file: "supabase/templates/confirmation.html",
    tag: "One more step",
    tagColor: "#f8e6b8",
    title: "Confirm your email",
    body: "Tap the button to confirm this address and finish setting up your account. The link works for 24 hours.",
    button: "Confirm my email",
    fine: "Didn't sign up for FormCraft? You can ignore this email. No account will be created.",
  },
  {
    file: "supabase/templates/recovery.html",
    tag: "Password reset",
    tagColor: "#dbe8f7",
    title: "Choose a new password",
    body: "Someone (hopefully you) asked to reset the password for this account. The link works once and expires in 1 hour.",
    button: "Reset password",
    fine: "Didn't ask for this? Ignore this email. Your password won't change.",
  },
];

for (const t of templates) {
  const html = renderEmailHtml({
    tag: t.tag,
    tagColor: t.tagColor,
    title: t.title,
    body: t.body,
    button: { label: t.button, href: "{{ .ConfirmationURL }}" },
    fine: t.fine,
    sentTo: "{{ .Email }}",
    raw: { buttonHref: true, sentTo: true },
  });
  writeFileSync(t.file, `${html}\n`);
  console.log(`wrote ${t.file}`);
}
