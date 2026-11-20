import { expect, test } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
  waitForSaved,
} from "./helpers";

/**
 * QA run 11 (FC11-05, FC11-06): the builder in a narrow, short window, the
 * size a desktop browser zoomed to 300% gives (about 427 × 300).
 */
const schema = {
  schemaVersion: 1,
  meta: { title: "Narrow form" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    {
      id: "q1",
      type: "short_text",
      order: 0,
      label: "Your name",
      required: false,
      settings: {},
    },
  ],
  logic: [],
} as unknown as FormSchemaV1;

/** Long enough that the list runs past the bottom of a short window. */
const longSchema = {
  ...schema,
  questions: Array.from({ length: 8 }, (_, i) => ({
    id: `q${i + 1}`,
    type: "short_text",
    order: i,
    label: `Question ${i + 1}`,
    required: false,
    settings: {},
  })),
} as unknown as FormSchemaV1;

test.describe("QA run 11: the builder in a narrow, short window", () => {
  test.use({ viewport: { width: 427, height: 300 } });
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;
  test.beforeEach(async () => {
    user = await createConfirmedUser("e2e-qa11");
  });
  test.afterEach(async () => {
    await deleteUser(user.userId);
  });

  test("FC11-05/06: Add question clear of the tab bar; every tap on a type adds one; undoing a setting needs no publish", async ({
    page,
  }, testInfo) => {
    const { formId } = await createPublishedForm(user, longSchema);
    const count = async () => {
      const { data } = await adminClient()
        .from("form_versions")
        .select("schema")
        .eq("form_id", formId)
        .eq("status", "draft")
        .single();
      return (data!.schema as unknown as FormSchemaV1).questions.length;
    };
    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}`);
    const tabs = page.getByRole("navigation", { name: "Builder" });
    await expect(tabs).toBeVisible();

    // The page is no taller than the window, so the pinned tab bar never
    // sits over the list's last control; and with a list longer than the
    // window, Add question is in sight without scrolling (run 12).
    await tabs.getByRole("button", { name: "Questions" }).click();
    const add = page.getByRole("button", { name: "Add question" });
    await expect(add).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath("questions.png") });
    const [addBox, tabBox] = [await add.boundingBox(), await tabs.boundingBox()];
    expect(addBox!.y + addBox!.height).toBeLessThanOrEqual(tabBox!.y + 2);
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight),
    ).toBeLessThanOrEqual(300);

    // Three types tapped one after another, each from a freshly opened menu.
    for (const [i, type] of ["Email", "Number", "Email"].entries()) {
      await tabs.getByRole("button", { name: "Questions" }).click();
      await add.click();
      const tile = page.locator(`button[data-type]`, { hasText: type }).first();
      await tile.scrollIntoViewIfNeeded();
      await tile.click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await waitForSaved(page);
      await expect.poll(count).toBe(9 + i);
      await page.screenshot({ path: testInfo.outputPath(`added-${i}.png`) });
    }

    // A double tap on a type adds it once (run 12).
    await tabs.getByRole("button", { name: "Questions" }).click();
    await add.click();
    const email = page.locator(`button[data-type]`, { hasText: "Email" }).first();
    await email.scrollIntoViewIfNeeded();
    await email.dblclick();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await waitForSaved(page);
    await expect.poll(count).toBe(12);

    // Publish, then a setting turned on and back off: nothing to publish.
    await page.getByRole("button", { name: /^Publish changes$/ }).click();
    await expect(page.getByRole("button", { name: /^Publish changes$/ })).toHaveCount(0);
    await tabs.getByRole("button", { name: "Settings" }).click();
    const required = page.getByRole("switch", { name: /Required/ });
    await required.click();
    await waitForSaved(page);
    await expect(page.getByRole("button", { name: /^Publish changes$/ })).toBeVisible();
    await required.click();
    await waitForSaved(page);
    await expect(page.getByRole("button", { name: /^Publish changes$/ })).toHaveCount(0);
  });
});

test.describe("QA run 11: the dashboard", () => {
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;
  test.beforeEach(async () => {
    user = await createConfirmedUser("e2e-qa11d");
  });
  test.afterEach(async () => {
    await deleteUser(user.userId);
  });

  test("FC11-14: a duplicate shows up without a reload", async ({ page }) => {
    await createPublishedForm(user, schema);
    await loginViaUI(page, user.email, user.password);
    await page.getByRole("button", { name: 'Actions for "Narrow form"' }).click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(
      page.getByRole("button", { name: 'Actions for "Narrow form (copy)"' }),
    ).toBeVisible();
    await expect(page.getByText(/^2 forms in /)).toBeVisible();
  });
});

test.describe("QA run 11: a touch phone", () => {
  test.use({ viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true });
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;
  test.beforeEach(async () => {
    user = await createConfirmedUser("e2e-qa11t");
  });
  test.afterEach(async () => {
    await deleteUser(user.userId);
  });

  test("FC11-05: Add question doesn't raise the keyboard, and a tapped type is added", async ({
    page,
  }) => {
    const { formId } = await createPublishedForm(user, schema);
    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}`);
    const tabs = page.getByRole("navigation", { name: "Builder" });
    await tabs.getByRole("button", { name: "Questions" }).tap();
    await page.getByRole("button", { name: "Add question" }).tap();
    const search = page.getByPlaceholder("Search question types");
    await expect(search).toBeVisible();
    await expect(search).not.toBeFocused();
    await page.locator("button[data-type]", { hasText: "Email" }).first().tap();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await waitForSaved(page);
    const { data } = await adminClient()
      .from("form_versions")
      .select("schema")
      .eq("form_id", formId)
      .eq("status", "draft")
      .single();
    expect(
      (data!.schema as unknown as FormSchemaV1).questions.map((q) => q.type),
    ).toEqual(["short_text", "email"]);
  });
});
