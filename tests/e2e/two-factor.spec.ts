import { test, expect } from "@playwright/test";
import { totp } from "../totp";
import {
  createConfirmedUser,
  deleteUser,
  loginViaUI,
  skipWelcomeDialog,
} from "./helpers";

/** Two-factor authentication (P3.13) in the browser: set it up in
 * Settings, save recovery codes, then log in with a code; a recovery
 * code gets back in and turns it off. */
test("set up 2FA, log in with a code, and recover with a recovery code", async ({
  page,
}) => {
  // Three sign-ins and a set-up: longer than the default budget.
  test.setTimeout(90_000);
  const user = await createConfirmedUser("e2e-mfa");
  try {
    await loginViaUI(page, user.email, user.password);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Set up" }).click();
    await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();
    const secret = (await page.locator("code").first().textContent())!.trim();
    await page.getByLabel("Code").fill(totp(secret));
    await page.getByRole("button", { name: "Turn on" }).click();
    const codes = page.locator("ul.font-mono li");
    await expect(codes).toHaveCount(10);
    const recovery = (await codes.nth(0).textContent())!.trim();
    await page.getByRole("button", { name: "I've saved them" }).click();
    await expect(page.getByText("10 recovery codes left.")).toBeVisible();

    // Logging in again now asks for a code before anything else.
    await page.context().clearCookies();
    await skipWelcomeDialog(page);
    await page.goto("/login?next=/settings");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/two-factor**");
    // The dashboard is out of reach until then.
    await page.goto("/dashboard");
    await page.waitForURL("**/two-factor**");
    await page.getByLabel("Code").fill("000000");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("That code didn't work.")).toBeVisible();
    await page.getByLabel("Code").fill(totp(secret));
    await page.getByRole("button", { name: "Continue" }).click();
    // Back where they were headed before the dashboard bounce.
    await page.waitForURL("**/dashboard");

    // A recovery code gets in once, and switches 2FA off.
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/two-factor**");
    await page.getByRole("button", { name: "Use a recovery code" }).click();
    await page.getByLabel("Recovery code").fill(recovery);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL("**/settings?tab=account&notice=two_factor_reset");
    await expect(page.getByText("You used a recovery code")).toBeVisible();
    await expect(page.getByRole("button", { name: "Set up" })).toBeVisible();
  } finally {
    await deleteUser(user.userId);
  }
});
