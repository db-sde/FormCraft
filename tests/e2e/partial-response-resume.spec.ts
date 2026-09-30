import { test, expect, type Browser } from "@playwright/test";
import {
  createConfirmedUser,
  deleteUser,
  loginViaUI,
  publishFromBuilder,
} from "./helpers";

test.describe("partial response resume", () => {
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;
  let liveLink: string;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedUser("e2e-resume");
    await loginViaUI(page, user.email, user.password);

    await page.getByRole("button", { name: "Start from scratch" }).click();
    await page.waitForURL(/\/forms\/[0-9a-f-]{36}$/);

    liveLink = await publishFromBuilder(page);
  });

  test.afterEach(async () => {
    await deleteUser(user.userId);
  });

  test("a refresh mid-form resumes from the same answer, not a blank restart", async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const respondentContext = await browser.newContext();
    const respondentPage = await respondentContext.newPage();
    await respondentPage.goto(liveLink);

    await respondentPage.getByRole("button", { name: /Start/ }).click();
    await respondentPage.getByRole("textbox").fill("Resuming Respondent");

    // Give the debounced autosave a moment to actually persist before
    // simulating an interrupted session.
    await respondentPage.waitForTimeout(1500);
    await respondentPage.reload();

    // Resumed onto the same question with the same in-progress answer —
    // not bounced back to the welcome screen.
    await expect(respondentPage.getByRole("textbox")).toHaveValue("Resuming Respondent");

    await respondentContext.close();
  });
});
