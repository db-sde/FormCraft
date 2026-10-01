import { test, expect, type Browser } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { createConfirmedUser, createPublishedForm, deleteUser } from "./helpers";

/** Like the builder's starter form: a welcome screen and one question.
 * Published directly — on phones the builder shows its "bigger screen"
 * state, and publishing through it is covered by publish-and-respond. */
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Resume me" },
  theme: {
    primaryColor: "#1f1f1f",
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
      label: "Hello",
      required: false,
      settings: {},
    },
    {
      id: "q_name",
      type: "short_text",
      order: 1,
      label: "What's your name?",
      required: true,
      settings: {},
    },
  ],
  logic: [],
};

test.describe("partial response resume", () => {
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;
  let liveLink: string;

  test.beforeEach(async () => {
    user = await createConfirmedUser("e2e-resume");
    ({ liveLink } = await createPublishedForm(user, schema));
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
