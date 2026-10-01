import { test, expect } from "@playwright/test";
import { createConfirmedUser, deleteUser, loginViaUI, logOutViaUI } from "./helpers";

/**
 * The whole emailed-link journey, through local Supabase's mail catcher
 * (Inbucket/Mailpit, started by `supabase start`). This flow was broken
 * three different ways at once with nothing noticing — the link's
 * redirect wasn't allowed, /reset-password bounced signed-in users, and
 * the browser Supabase client couldn't read its env — so it gets a test
 * that follows the real link rather than any shortcut.
 */
const MAIL_API = process.env.INBUCKET_URL ?? "http://127.0.0.1:54324";

async function latestLinkFor(email: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const search = await fetch(`${MAIL_API}/api/v1/search?query=to:${email}`);
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    if (messages.length > 0) {
      const message = await fetch(`${MAIL_API}/api/v1/message/${messages[0].ID}`);
      const { HTML } = (await message.json()) as { HTML: string };
      const href = HTML.match(/href="([^"]+)"/)?.[1];
      if (href) return href.replaceAll("&amp;", "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no email arrived for ${email}`);
}

test.describe("password reset", () => {
  test("emailed link lets the user set a new password and log in with it", async ({
    page,
  }) => {
    const user = await createConfirmedUser("e2e-reset");
    try {
      await page.goto("/forgot-password");
      await page.getByLabel("Email").fill(user.email);
      await page.getByRole("button", { name: /send/i }).click();
      await page.waitForURL("**/forgot-password/check-email");

      await page.goto(await latestLinkFor(user.email));
      await page.waitForURL("**/reset-password");

      const newPassword = `Reset-${crypto.randomUUID()}`;
      await page.getByLabel("New password").fill(newPassword);
      await page.getByLabel("Confirm password").fill(newPassword);
      await page.getByRole("button", { name: "Save new password" }).click();
      await page.waitForURL("**/dashboard");

      await logOutViaUI(page);
      await loginViaUI(page, user.email, newPassword);
      await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    } finally {
      await deleteUser(user.userId);
    }
  });

  test("an invalid link explains itself on the login page", async ({ page }) => {
    await page.goto("/auth/confirm?code=not-a-real-code&next=/reset-password");
    await page.waitForURL("**/login?notice=link_invalid");
    // An expired link is a warning banner (role="alert"), not a status.
    await expect(page.getByRole("alert").filter({ hasText: "expired" })).toBeVisible();
  });
});
