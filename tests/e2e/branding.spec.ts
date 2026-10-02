import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
} from "./helpers";

/**
 * P2.1 and P2.22 on the live form: switching the badge off or picking a
 * paid font in the saved form isn't enough — the server applies the
 * workspace's plan when it renders the form.
 */
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Branded" },
  theme: {
    primaryColor: "#1f1f1f",
    backgroundColor: "#ffffff",
    fontFamily: "lora",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "All done", isDefault: true, showMadeWith: false }],
  questions: [
    {
      id: "q1",
      type: "short_text",
      order: 0,
      label: "Name?",
      required: true,
      settings: {},
    },
  ],
  logic: [],
};

async function finish(page: import("@playwright/test").Page, link: string) {
  await page.goto(link);
  await page.getByRole("textbox").fill("Ada");
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByRole("heading", { name: "All done" })).toBeVisible();
}

const fontOf = (page: import("@playwright/test").Page) =>
  page
    .locator(".fc-stage")
    .first()
    .evaluate((el) => getComputedStyle(el).fontFamily);

test("the plan decides the badge and paid fonts, not the saved form", async ({
  page,
}) => {
  const user = await createConfirmedUser("e2e-branding");
  try {
    const { liveLink } = await createPublishedForm(user, schema);

    // Free (a new workspace, no grandfathering): badge stays, Lora becomes Inter.
    await finish(page, liveLink);
    await expect(page.getByText("Made with FormCraft")).toBeVisible();
    expect(await fontOf(page)).not.toContain("Lora");

    await adminClient()
      .from("workspaces")
      .update({ plan_id: "pro" })
      .eq("owner_id", user.userId);
    await finish(page, liveLink);
    await expect(page.getByText("Made with FormCraft")).toHaveCount(0);
    expect(await fontOf(page)).toContain("Lora");
  } finally {
    await deleteUser(user.userId);
  }
});
