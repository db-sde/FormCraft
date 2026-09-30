import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
} from "./helpers";

/**
 * Regression: autosaves reused the last *acknowledged* revision, so when
 * a save was still in flight (slow network, cold API route) the next
 * one carried the same revision, the server rejected it as stale, and
 * the client wiped the session and reloaded — restarting the form from
 * question one a few seconds after the respondent typed. Slows every
 * save down to force that overlap.
 */
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Autosave race" },
  theme: {
    primaryColor: "#0f172a",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "Thanks!", isDefault: true }],
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
      id: "q_notes",
      type: "long_text",
      order: 1,
      label: "Anything else?",
      required: false,
      settings: {},
    },
  ],
  logic: [],
};

test("overlapping slow autosaves never restart the form", async ({ page }) => {
  const user = await createConfirmedUser("e2e-autosave");
  try {
    const { liveLink } = await createPublishedForm(user, schema);

    await page.route("**/api/responses/*/answers", async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });

    await page.goto(liveLink);
    const name = page.getByRole("textbox");
    await name.fill("Ada");
    await page.waitForTimeout(900); // first save goes out, stalls 1.5s
    await name.fill("Ada Lovelace");
    await page.waitForTimeout(900); // second change lands while it's in flight
    await name.fill("Ada Lovelace!");
    await page.waitForTimeout(5000); // let every save settle

    // Still here, with the latest text — not reloaded to a blank start.
    await expect(page.getByText("Your name")).toBeVisible();
    await expect(name).toHaveValue("Ada Lovelace!");

    // And the server holds the latest answer.
    const admin = adminClient();
    const { data: answers } = await admin
      .from("answers")
      .select("value")
      .eq("question_id", "q_name");
    expect(answers?.map((a) => a.value)).toContain("Ada Lovelace!");

    // Resume after a refresh keeps both the answer and Back history.
    await page.keyboard.press("Enter");
    await expect(page.getByText("Anything else?")).toBeVisible();
    await page.waitForTimeout(3000);
    await page.reload();
    await expect(page.getByText("Anything else?")).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("textbox")).toHaveValue("Ada Lovelace!");
  } finally {
    await deleteUser(user.userId);
  }
});
