import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
} from "./helpers";

/**
 * The point of lead capture: contact details entered before the last
 * question are kept even when the respondent never submits — and they
 * show up for the creator under Leads and Responses → Incomplete.
 */
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Quote request" },
  theme: {
    primaryColor: "#4f46e5",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "Thanks!", isDefault: true }],
  questions: [
    {
      id: "q_contact",
      type: "contact_info",
      order: 0,
      label: "Where can we reach you?",
      required: true,
      settings: { fields: ["name", "email", "phone"], requiredFields: ["name", "email"] },
    },
    {
      id: "q_last",
      type: "long_text",
      order: 1,
      label: "What do you need?",
      required: true,
      settings: {},
    },
  ],
  logic: [],
};

test("a respondent who leaves before the last question is still a lead", async ({
  page,
  browser,
}) => {
  const user = await createConfirmedUser("e2e-leads");
  try {
    const { formId, liveLink } = await createPublishedForm(user, schema);

    const respondentContext = await browser.newContext();
    const r = await respondentContext.newPage();
    await r.goto(liveLink);
    await r.getByLabel("Name").fill("Grace Hopper");
    // Enter moves between the contact fields rather than skipping ahead.
    await r.keyboard.press("Enter");
    await r.keyboard.type("grace@example.com");
    await r.keyboard.press("Enter");
    await expect(r.getByLabel("Phone")).toBeFocused();
    await r.keyboard.type("+1 555 010 2030");
    await r.keyboard.press("Enter");

    await expect(r.getByText("What do you need?")).toBeVisible();
    await r.waitForTimeout(2000); // autosave settles, then they leave
    await respondentContext.close();

    await loginViaUI(page, user.email, user.password);
    await page.goto("/leads");
    const row = page.getByRole("row", { name: /Grace Hopper/ });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row).toContainText("grace@example.com");
    await expect(row).toContainText("+1 555 010 2030");
    await expect(row).toContainText("Didn't finish");

    await page.goto(`/forms/${formId}/responses?view=incomplete`);
    await expect(page.getByRole("link", { name: /Incomplete\s*1/ })).toBeVisible();
    await expect(page.getByText("What do you need?").last()).toBeVisible();
  } finally {
    await deleteUser(user.userId);
  }
});
