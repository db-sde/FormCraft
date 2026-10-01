import { test, expect, type Browser, type Page } from "@playwright/test";
import {
  createConfirmedUser,
  deleteUser,
  loginViaUI,
  publishFromBuilder,
  startFromScratch,
} from "./helpers";

test.describe("publish and respond", () => {
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedUser("e2e-publish");
    await loginViaUI(page, user.email, user.password);
  });

  test.afterEach(async () => {
    await deleteUser(user.userId);
  });

  test("publish the starter form, complete it anonymously (lead included), see the response and the lead", async ({
    page,
    browser,
  }: {
    page: Page;
    browser: Browser;
  }) => {
    await startFromScratch(page);
    await page.waitForURL(/\/forms\/[0-9a-f-]{36}$/);
    const formId = page.url().split("/forms/")[1];

    // The starter form: welcome → question → contact info (lead
    // capture) → optional last question. Publish it as-is.
    const liveLink = await publishFromBuilder(page);

    // A separate browser context — no cookies shared with the creator.
    const respondentContext = await browser.newContext();
    const r = await respondentContext.newPage();
    await r.goto(liveLink);

    await r.getByRole("button", { name: /Start/ }).click();
    await r.getByRole("textbox").fill("I need a quote for 20 seats.");
    await r.keyboard.press("Enter");

    await r.getByLabel("Name").fill("Ada Lovelace");
    await r.getByLabel("Email").fill("ada@example.com");
    await r.getByRole("button", { name: "OK" }).click();

    await expect(r.getByText("Anything else we should know?")).toBeVisible();
    await r.getByRole("button", { name: "Submit" }).click();
    await expect(r.getByText("Thank you!")).toBeVisible({ timeout: 10000 });
    await respondentContext.close();

    // Back as the creator: one completed response, and the lead.
    await page.goto(`/forms/${formId}/responses`);
    await expect(page.getByText("1 response", { exact: true })).toBeVisible({
      timeout: 10000,
    });
    await page.goto("/leads");
    await expect(page.getByRole("cell", { name: "Ada Lovelace" })).toBeVisible();
    await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  });
});
