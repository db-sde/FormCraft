import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
} from "./helpers";

const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Settings test" },
  theme: {
    primaryColor: "#4f46e5",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "Thanks!", isDefault: true }],
  questions: [
    {
      id: "q_a",
      type: "short_text",
      order: 0,
      label: "First",
      required: true,
      settings: {},
    },
    {
      id: "q_b",
      type: "short_text",
      order: 1,
      label: "Second",
      required: true,
      settings: {},
    },
  ],
  logic: [],
};

test("turning off saving keeps unfinished answers off the server; the link can be renamed", async ({
  page,
  browser,
}) => {
  const user = await createConfirmedUser("e2e-settings");
  const admin = adminClient();
  try {
    const { formId, liveLink } = await createPublishedForm(user, schema);
    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}/settings`);
    await page.getByRole("switch", { name: "Save answers as people go" }).click();
    await expect(
      page.getByText(/nothing is stored until someone submits/i),
    ).toBeVisible();
    // Wait for the server to confirm, not just the optimistic switch.
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    await expect
      .poll(
        async () =>
          (
            await admin
              .from("forms")
              .select("save_partial_responses")
              .eq("id", formId)
              .single()
          ).data?.save_partial_responses,
      )
      .toBe(false);

    // Respondent: no "saved as you go" notice, and typing stores nothing.
    const respondentContext = await browser.newContext();
    const r = await respondentContext.newPage();
    await r.goto(liveLink);
    await expect(r.getByText("Your answers are saved as you go.")).toHaveCount(0);
    await r.getByRole("textbox").fill("Private answer");
    await r.keyboard.press("Enter");
    await expect(r.getByText("Second")).toBeVisible();
    await r.waitForTimeout(2000);
    const { data: answers } = await admin
      .from("answers")
      .select("question_id, responses!inner(form_id)")
      .eq("responses.form_id", formId);
    expect(answers).toEqual([]);
    await respondentContext.close();

    // New link works, old one doesn't.
    const newSlug = `renamed-${crypto.randomUUID().slice(0, 8)}`;
    await page.getByLabel("Link", { exact: true }).fill(newSlug);
    await page.getByRole("button", { name: "Save link" }).click();
    await expect(page.getByText("Link updated")).toBeVisible();
    const fresh = await browser.newContext();
    const check = await fresh.newPage();
    await check.goto(`/f/${newSlug}`);
    await expect(check.getByText("First")).toBeVisible();
    await check.goto(liveLink);
    await expect(check.getByText("This form isn't available")).toBeVisible();
    await fresh.close();
  } finally {
    await deleteUser(user.userId);
  }
});
