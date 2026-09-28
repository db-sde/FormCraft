import { test, expect } from "@playwright/test";
import { createConfirmedUser, deleteUser, loginViaUI } from "./helpers";

test.describe("form builder", () => {
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedUser("e2e-builder");
    await loginViaUI(page, user.email, user.password);
  });

  test.afterEach(async () => {
    await deleteUser(user.userId);
  });

  test("dashboard empty state creates a form and lands in the builder", async ({
    page,
  }) => {
    await expect(page.getByText("No forms yet")).toBeVisible();
    await page.getByRole("button", { name: "Start from scratch" }).click();

    await page.waitForURL(/\/forms\/[0-9a-f-]{36}$/);
    // The starter schema's welcome screen question is selected by default.
    await expect(page.getByText("WELCOME SCREEN")).toBeVisible();
  });

  test("add, edit, and delete a question, with autosave confirming the write persisted", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Start from scratch" }).click();
    await page.waitForURL(/\/forms\/[0-9a-f-]{36}$/);

    await page.getByRole("button", { name: "Add question" }).click();
    await page.getByRole("menuitem", { name: "Short text" }).click();

    const questionTextInput = page.getByPlaceholder("Question text");
    await expect(questionTextInput).toBeVisible();
    await questionTextInput.fill("What's your favorite color?");

    // Wait for the debounced autosave to actually round-trip.
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 5000 });

    await page.reload();
    await expect(page.getByText("What's your favorite color?")).toBeVisible();

    // Delete the question we just added (its delete button is scoped to
    // its row in the question list sidebar).
    await page
      .getByRole("button", { name: 'Delete "What\'s your favorite color?"' })
      .click();
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 5000 });

    await page.reload();
    await expect(page.getByText("What's your favorite color?")).not.toBeVisible();
  });
});
