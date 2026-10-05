import { test, expect } from "@playwright/test";
import { createConfirmedUser, deleteUser, loginViaUI, logOutViaUI } from "./helpers";

test.describe("auth", () => {
  test("signup with email confirmation off goes straight into the app", async ({
    page,
  }) => {
    await page.goto("/signup");
    const email = `e2e-signup-${crypto.randomUUID().slice(0, 8)}@example.com`;
    await page.getByLabel("Full name").fill("E2E Test User");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(`Test-${crypto.randomUUID()}`);
    await page.getByRole("button", { name: "Create account" }).click();

    // Confirmation is off here, so there's no inbox step: they're signed in.
    await page.waitForURL("**/dashboard");
    await expect(
      page.getByRole("dialog", { name: "How do you want to start?" }),
    ).toBeVisible();
  });

  test("login with valid credentials reaches the dashboard, logout returns to login", async ({
    page,
  }) => {
    const user = await createConfirmedUser("e2e-login");
    try {
      await loginViaUI(page, user.email, user.password);
      await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();

      await logOutViaUI(page);
      await expect(page.getByLabel("Email")).toBeVisible();
    } finally {
      await deleteUser(user.userId);
    }
  });

  test("login with wrong password shows an error and stays on the login page", async ({
    page,
  }) => {
    const user = await createConfirmedUser("e2e-badlogin");
    try {
      await page.goto("/login");
      await page.getByLabel("Email").fill(user.email);
      await page.getByLabel("Password").fill("definitely-wrong-password");
      await page.getByRole("button", { name: "Log in" }).click();

      await expect(
        page.getByText(
          "That email and password don't match. Try again, or reset your password.",
        ),
      ).toBeVisible();
      await expect(page).toHaveURL(/\/login/);
    } finally {
      await deleteUser(user.userId);
    }
  });
});
