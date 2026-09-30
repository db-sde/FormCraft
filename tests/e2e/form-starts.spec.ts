import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
} from "./helpers";

/**
 * PRD: a "form start" is the respondent's first interaction, not the
 * page load. Merely opening the form must not create a response (or a
 * Start); pressing Start does — and records where the visit came from.
 */
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Starts" },
  theme: {
    primaryColor: "#4f46e5",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "Thanks!", isDefault: true }],
  questions: [
    {
      id: "q_welcome",
      type: "welcome_screen",
      order: 0,
      label: "Hi",
      required: false,
      settings: { buttonLabel: "Start" },
    },
    {
      id: "q_name",
      type: "short_text",
      order: 1,
      label: "Name",
      required: true,
      settings: {},
    },
  ],
  logic: [],
};

test("opening the form isn't a start; the first interaction is, with its campaign", async ({
  page,
}) => {
  const user = await createConfirmedUser("e2e-starts");
  const admin = adminClient();
  try {
    const { formId, liveLink } = await createPublishedForm(user, schema);
    const responsesFor = async () =>
      (
        await admin
          .from("responses")
          .select("status, utm_source, utm_campaign")
          .eq("form_id", formId)
      ).data ?? [];

    await page.goto(`${liveLink}?utm_source=linkedin&utm_campaign=launch`);
    await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await responsesFor()).toHaveLength(0);

    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByText("Name")).toBeVisible();
    await expect
      .poll(responsesFor, { timeout: 10000 })
      .toEqual([
        { status: "in_progress", utm_source: "linkedin", utm_campaign: "launch" },
      ]);

    await page.getByRole("textbox").fill("Grace");
    await expect
      .poll(async () => (await responsesFor())[0]?.status, { timeout: 10000 })
      .toBe("partial");
  } finally {
    await deleteUser(user.userId);
  }
});
