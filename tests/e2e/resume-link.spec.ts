import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
} from "./helpers";

/**
 * Resume links (P2.8): a respondent asks for a link, opens it somewhere
 * else (a separate browser context, so no shared localStorage), lands
 * where they stopped with their answer kept, and finishing completes
 * the same response — one row, no duplicate.
 */
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Finish later" },
  theme: {
    primaryColor: "#1f1f1f",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "All done", isDefault: true }],
  questions: [
    {
      id: "q_name",
      type: "short_text",
      order: 0,
      label: "Your name?",
      required: true,
      settings: {},
    },
    {
      id: "q_team",
      type: "short_text",
      order: 1,
      label: "Your team?",
      required: true,
      settings: {},
    },
  ],
  logic: [],
};

test("a resume link continues the same response on another device", async ({
  page,
  browser,
}) => {
  const user = await createConfirmedUser("e2e-resume");
  try {
    const { formId, liveLink } = await createPublishedForm(user, schema);
    await adminClient()
      .from("forms")
      .update({ resume_links_enabled: true })
      .eq("id", formId);

    await page.goto(liveLink);
    await page.getByRole("textbox").fill("Grace");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: /Your team/ })).toBeVisible();

    await page.getByRole("button", { name: "Finish later" }).click();
    const linkField = page.getByLabel("Your link to finish later");
    await expect(linkField).toHaveValue(/\?resume=[A-Za-z0-9_-]{43}$/);
    const link = await linkField.inputValue();

    const other = await browser.newContext();
    try {
      const phone = await other.newPage();
      await phone.goto(link);
      await expect(phone.getByRole("heading", { name: /Your team/ })).toBeVisible();
      // The token doesn't stay in the address bar.
      await expect(phone).not.toHaveURL(/resume=/);
      // The earlier answer came along: go back to it and on again.
      await phone.getByRole("button", { name: "Back" }).click();
      await expect(phone.getByRole("textbox")).toHaveValue("Grace");
      await phone.keyboard.press("Enter");
      await expect(phone.getByRole("heading", { name: /Your team/ })).toBeVisible();
      await phone.getByRole("textbox").fill("Research");
      await phone.getByRole("button", { name: "Submit" }).click();
      await expect(phone.getByRole("heading", { name: "All done" })).toBeVisible();

      // Back on the first device the link is spent.
      await page.goto(link);
      await expect(
        page.getByText(
          "Those answers were already submitted. You can fill the form again.",
        ),
      ).toBeVisible();
    } finally {
      await other.close();
    }

    const { data } = await adminClient()
      .from("responses")
      .select("status, answers(question_id, value)")
      .eq("form_id", formId);
    expect(data).toHaveLength(1);
    expect(data?.[0].status).toBe("completed");
    expect(
      Object.fromEntries((data?.[0].answers ?? []).map((a) => [a.question_id, a.value])),
    ).toEqual({ q_name: "Grace", q_team: "Research" });
  } finally {
    await deleteUser(user.userId);
  }
});

test("there's no finish-later link unless the creator turns it on", async ({ page }) => {
  const user = await createConfirmedUser("e2e-resume-off");
  try {
    const { liveLink } = await createPublishedForm(user, schema);
    await page.goto(liveLink);
    await page.getByRole("textbox").fill("Grace");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: /Your team/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Finish later" })).toHaveCount(0);
  } finally {
    await deleteUser(user.userId);
  }
});
