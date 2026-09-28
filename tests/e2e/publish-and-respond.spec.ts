import { test, expect, type Browser } from "@playwright/test";
import { createConfirmedUser, deleteUser, loginViaUI } from "./helpers";

test.describe("publish and respond", () => {
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedUser("e2e-publish");
    await loginViaUI(page, user.email, user.password);
  });

  test.afterEach(async () => {
    await deleteUser(user.userId);
  });

  test("publish a form, complete it anonymously in a fresh browser context, see it in the creator's response dashboard", async ({
    page,
    browser,
  }: {
    page: import("@playwright/test").Page;
    browser: Browser;
  }) => {
    await page.getByRole("button", { name: "Start from scratch" }).click();
    await page.waitForURL(/\/forms\/[0-9a-f-]{36}$/);
    const formUrl = page.url();
    const formId = formUrl.split("/forms/")[1];

    // The starter schema already has one required short_text question
    // ("What's your name?") after the welcome screen — publish as-is.
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByRole("link", { name: "View live" })).toBeVisible({
      timeout: 10000,
    });
    const liveLink = await page
      .getByRole("link", { name: "View live" })
      .getAttribute("href");
    expect(liveLink).toBeTruthy();

    // A genuinely separate browser context — no cookies shared with the
    // creator's session — to act as an anonymous respondent.
    const respondentContext = await browser.newContext();
    const respondentPage = await respondentContext.newPage();
    await respondentPage.goto(liveLink!);

    await expect(respondentPage.getByRole("button", { name: /Start/ })).toBeVisible();
    await respondentPage.getByRole("button", { name: /Start/ }).click();

    await respondentPage.getByRole("textbox").fill("Ada Lovelace");
    await respondentPage.keyboard.press("Enter");

    await expect(respondentPage.getByText("Thank you!")).toBeVisible({ timeout: 10000 });
    await respondentContext.close();

    // Back in the creator's session: the response shows up.
    await page.goto(`/forms/${formId}/responses`);
    await expect(page.getByText("1 response")).toBeVisible({ timeout: 10000 });
  });
});
