import { test, expect } from "@playwright/test";
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
 * Progressive profiling (logic spec phase 23) in the browser: a visitor
 * who told one form their company isn't asked again on the workspace's
 * next form; the answer is filled in for them, they can choose to answer
 * again, and a different browser is asked as usual.
 */
const theme = {
  primaryColor: "#1f1f1f",
  backgroundColor: "#ffffff",
  fontFamily: "inter",
  buttonStyle: "rounded",
} as const;
const text = (id: string, order: number, label: string, profileKey?: string) => ({
  id,
  type: "short_text" as const,
  order,
  label,
  required: true,
  settings: {},
  ...(profileKey ? { profileKey } : {}),
});

const signup = {
  schemaVersion: 1,
  meta: { title: "Signup" },
  theme,
  endings: [{ id: "end", title: "Signed up", isDefault: true }],
  questions: [text("co", 0, "Which company are you with?", "company")],
  logic: [],
} as unknown as FormSchemaV1;

const survey = {
  schemaVersion: 1,
  meta: { title: "Survey" },
  theme,
  endings: [{ id: "end", title: "Survey done", isDefault: true }],
  questions: [
    text("name", 0, "What should we call you?"),
    text("company", 1, "Your company", "company"),
    text("role", 2, "What's your role?"),
  ],
  logic: [],
} as unknown as FormSchemaV1;

test("a returning visitor isn't asked twice, and can choose to answer again", async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000);
  const user = await createConfirmedUser("e2e-profile");
  try {
    const first = await createPublishedForm(user, signup);
    const second = await createPublishedForm(user, survey);
    const admin = adminClient();

    await page.goto(first.liveLink);
    await page.getByRole("textbox").fill("Analytical Engines");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByRole("heading", { name: "Signed up" })).toBeVisible();
    await expect
      .poll(
        async () =>
          (
            await admin
              .from("visitor_profiles")
              .select("key")
              .eq("value", '"Analytical Engines"')
          ).data?.length,
      )
      .toBe(1);

    // Same browser, next form: the company question is passed over.
    await page.goto(second.liveLink);
    await page.getByRole("textbox").fill("Ada");
    await page.getByRole("button", { name: "OK" }).click();
    await expect(page.getByRole("heading", { name: "What's your role?" })).toBeVisible();
    await expect(page.getByText("We skipped what you've answered before.")).toBeVisible();
    // Going back steps over it too: the remembered answer is never shown.
    await page.getByRole("button", { name: "Back" }).click();
    await expect(
      page.getByRole("heading", { name: "What should we call you?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "OK" }).click();
    await page.getByRole("textbox").fill("Engineer");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByRole("heading", { name: "Survey done" })).toBeVisible();
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("responses")
          .select("answers(question_id, value)")
          .eq("form_id", second.formId)
          .eq("status", "completed")
          .maybeSingle();
        return Object.fromEntries(
          (data?.answers ?? []).map((a) => [a.question_id, a.value]),
        );
      })
      .toEqual({ name: "Ada", company: "Analytical Engines", role: "Engineer" });

    // "Answer again" asks it after all (someone else on this browser).
    await page.evaluate(() => window.localStorage.clear());
    await page.goto(second.liveLink);
    await page.getByRole("textbox").fill("Grace");
    await page.getByRole("button", { name: "OK" }).click();
    await page.getByRole("button", { name: "Answer again" }).click();
    await expect(page.getByRole("heading", { name: "Your company" })).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveValue("");

    // A different browser has nothing remembered.
    const other = await browser.newContext();
    const fresh = await other.newPage();
    await fresh.goto(second.liveLink);
    await fresh.getByRole("textbox").fill("Lin");
    await fresh.getByRole("button", { name: "OK" }).click();
    await expect(fresh.getByRole("heading", { name: "Your company" })).toBeVisible();
    await other.close();

    // The creator switches it on in the builder.
    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${second.formId}`);
    await page
      .getByRole("button", { name: /What's your role\?/ })
      .first()
      .click();
    await page.getByRole("switch", { name: "Ask once per person" }).click();
    await expect(page.getByLabel("Remembered as")).toHaveValue("what_s_your_role");
    await waitForSaved(page);
    const { data: draft } = await admin
      .from("form_versions")
      .select("schema")
      .eq("form_id", second.formId)
      .eq("status", "draft")
      .single();
    expect((draft!.schema as unknown as FormSchemaV1).questions[2].profileKey).toBe(
      "what_s_your_role",
    );
  } finally {
    await deleteUser(user.userId);
  }
});
