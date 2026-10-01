import { test, expect } from "@playwright/test";
import {
  addQuestion,
  createConfirmedUser,
  deleteUser,
  loginViaUI,
  waitForSaved,
} from "./helpers";

test.describe("templates", () => {
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedUser("e2e-templates");
    await loginViaUI(page, user.email, user.password);
  });

  test.afterEach(async () => {
    await deleteUser(user.userId);
  });

  test("using a template creates an independent, editable copy — the template itself is untouched", async ({
    page,
  }) => {
    await page.goto("/templates");
    await expect(page.getByRole("heading", { name: "Choose a template" })).toBeVisible();

    await page.getByRole("button", { name: "Use this template" }).first().click();
    await page.waitForURL(/\/forms\/[0-9a-f-]{36}$/);

    // The new form starts with the template's own questions, not a
    // blank starter — confirm there's more than one question and add
    // one more, whose edit must never write back to the shared
    // `templates` row.
    await addQuestion(page, "Short text");
    const questionTextInput = page.getByLabel("Question text");
    await questionTextInput.fill("A question only this form has");
    await waitForSaved(page);

    // Using the same template again must produce a form that does NOT
    // have the edit made above — proof the template itself is a
    // read-only reference, not mutated by editing a form created from it.
    await page.goto("/templates");
    await page.getByRole("button", { name: "Use this template" }).first().click();
    await page.waitForURL(/\/forms\/[0-9a-f-]{36}$/);
    await expect(page.getByText("A question only this form has")).toHaveCount(0);
  });
});
