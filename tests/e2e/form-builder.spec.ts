import { test, expect } from "@playwright/test";
import {
  addQuestion,
  createConfirmedUser,
  deleteUser,
  loginViaUI,
  startFromScratch,
  waitForSaved,
} from "./helpers";

test.describe("form builder", () => {
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedUser("e2e-builder");
    await loginViaUI(page, user.email, user.password);
  });

  test.afterEach(async () => {
    await deleteUser(user.userId);
  });

  test("first sign-in: the welcome dialog creates a blank form and lands in the builder", async ({
    browser,
  }) => {
    // A browser that has never seen the dialog.
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await loginViaUI(page, user.email, user.password, { welcome: true });
      const dialog = page.getByRole("dialog", { name: "How do you want to start?" });
      await expect(dialog).toBeVisible();
      await startFromScratch(page);

      // The starter schema's welcome screen question is selected by default.
      await expect(page.getByText("Always shown first")).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("add, edit, and delete a question, with autosave confirming the write persisted", async ({
    page,
  }) => {
    await startFromScratch(page);

    await addQuestion(page, "Short text");

    const questionTextInput = page.getByLabel("Question text");
    await expect(questionTextInput).toBeVisible();
    await questionTextInput.fill("What's your favorite color?");

    // Wait for the debounced autosave to actually round-trip.
    await waitForSaved(page);

    await page.reload();
    await expect(
      page.getByRole("button", { name: /What's your favorite color\?/ }).first(),
    ).toBeVisible();

    // Delete the question we just added (its delete button is scoped to
    // its row in the question list sidebar).
    await page
      .getByRole("button", { name: /What's your favorite color\?/ })
      .first()
      .click();
    await page
      .getByRole("button", { name: 'Delete "What\'s your favorite color?"' })
      .click();
    await waitForSaved(page);

    await page.reload();
    await expect(page.getByText("What's your favorite color?")).toHaveCount(0);
  });
});
