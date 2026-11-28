import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
  waitForSaved,
} from "./helpers";

/**
 * Answer recall (QA FC15-41): "@" in a question's text offers earlier
 * answers, a placeholder that matches nothing is called out, and the
 * picked answer shows on the live form.
 */
const schema = {
  schemaVersion: 1,
  meta: { title: "Recall" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    {
      id: "q_name",
      type: "short_text",
      order: 0,
      label: "Your name",
      required: true,
      settings: {},
    },
    {
      id: "q_more",
      type: "long_text",
      order: 1,
      label: "Anything else?",
      required: false,
      settings: {},
    },
  ],
  logic: [],
} as unknown as FormSchemaV1;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

test("@ picks an earlier answer; unknown placeholders are called out", async ({
  page,
  browser,
}) => {
  const user = await createConfirmedUser("e2e-recall");
  try {
    const { formId, liveLink } = await createPublishedForm(user, schema);
    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}`);
    await page
      .getByRole("list", { name: "Questions" })
      .getByRole("button", { name: /^2 / })
      .click();

    const text = page.getByLabel("Question text");
    await text.fill("Hi {{name}}, anything else?");
    await expect(
      page.getByText(/\{\{name\}\} doesn't match an earlier answer/),
    ).toBeVisible();

    await text.fill("Thanks ");
    await text.press("End");
    await text.pressSequentially("@you");
    const menu = page.getByRole("listbox", { name: "Insert an answer" });
    await expect(menu.getByRole("option", { name: "Your name" })).toBeVisible();
    // A later question isn't offered.
    await expect(menu.getByRole("option", { name: "Anything else?" })).toHaveCount(0);
    await text.press("Enter");
    await expect(text).toHaveValue("Thanks {{answer:q_name}}");
    await expect(page.getByText(/doesn't match an earlier answer/)).toHaveCount(0);
    await waitForSaved(page);
    await page.getByRole("button", { name: "Publish changes" }).click();
    await expect(
      page
        .getByText("Live", { exact: true })
        .or(page.getByText(/Published/))
        .first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish changes" })).toHaveCount(0);

    const visitor = await browser.newContext({ userAgent: BROWSER_UA });
    const form = await visitor.newPage();
    await form.goto(liveLink);
    await form.getByRole("textbox").fill("Ada");
    await form.keyboard.press("Enter");
    await expect(form.getByText("Thanks Ada")).toBeVisible();
    await visitor.close();
  } finally {
    await deleteUser(user.userId);
  }
});
