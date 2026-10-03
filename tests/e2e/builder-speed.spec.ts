import { test, expect } from "@playwright/test";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
  waitForSaved,
} from "./helpers";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";

/**
 * The shortest path to a published form: from the dashboard, a named
 * form with a choice question is two clicks — "New form" and "Publish" —
 * and the rest is typing. Guards the keyboard flow in the builder (focus
 * after adding, Enter to move on, the type search, the options list),
 * naming the form once, and getting the link at publish.
 */
test("dashboard to a named, published form in two clicks", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const user = await createConfirmedUser("e2e-speed");
  try {
    await loginViaUI(page, user.email, user.password);

    // Click 1.
    await page.getByRole("button", { name: "New form" }).first().click();
    await page.waitForURL(/\/forms\/[0-9a-f-]{36}$/);
    const formId = page.url().split("/").at(-1)!;

    // An unnamed form opens with its title selected: typing names it, in
    // the builder's top bar too.
    const title = page.getByLabel("Question text");
    await expect(title).toBeFocused();
    await page.keyboard.type("Team lunch");
    await expect(page.getByLabel("Form name")).toHaveValue("Team lunch");

    // Enter moves to "Add question"; Enter opens it on its search, where a
    // few letters and Enter pick a type by name (not Email's "Checked
    // automatically").
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Add question" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Search question types")).toBeFocused();
    await page.keyboard.type("check");
    await page.keyboard.press("Enter");

    // The new question's starter wording is selected, ready to type over.
    await expect(page.getByText("Checkboxes", { exact: true }).first()).toBeVisible();
    await expect(title).toBeFocused();
    await page.keyboard.type("What do you eat?");
    await page.keyboard.press("Enter");

    // Options: Enter goes to the next (an unedited one first, then new
    // ones); a last Enter on an untouched option ends the list.
    for (const option of ["Vegetarian", "Vegan", "Anything"]) {
      await page.keyboard.type(option);
      await page.keyboard.press("Enter");
    }
    await page.keyboard.press("Enter");
    const options = page.locator("[data-option-input]");
    await expect(options).toHaveCount(3);
    expect(
      await options.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)),
    ).toEqual(["Vegetarian", "Vegan", "Anything"]);
    // Backspace on an emptied option removes it.
    await options.nth(1).focus();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await expect(options).toHaveCount(2);

    // Click 2: the first publish puts the link on the clipboard.
    await waitForSaved(page);
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByText("Published.", { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByText("Link copied. Paste it anywhere to share."),
    ).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/\/f\/[a-z0-9-]+$/);
    // Nothing unfinished was left behind, so no heads-up.
    await expect(page.getByText(/still ha(s|ve) starter wording/)).toHaveCount(0);

    const admin = adminClient();
    await expect
      .poll(
        async () =>
          (await admin.from("forms").select("title").eq("id", formId).single()).data
            ?.title,
      )
      .toBe("Team lunch");
    const { data: live } = await admin
      .from("form_versions")
      .select("schema")
      .eq("form_id", formId)
      .eq("status", "published")
      .single();
    const schema = live!.schema as unknown as FormSchemaV1;
    expect(schema.meta.title).toBe("Team lunch");
    const added = schema.questions.find((q) => q.type === "multi_select")!;
    expect(added.label).toBe("What do you eat?");
    expect(
      (added.settings as { options: { label: string }[] }).options.map((o) => o.label),
    ).toEqual(["Vegetarian", "Anything"]);

    // Renaming the form in the top bar unlinks it from the welcome title.
    await page.getByLabel("Form name").fill("Lunch poll (internal)");
    await page.getByLabel("Form name").press("Enter");
    await page
      .getByRole("button", { name: /Team lunch/ })
      .first()
      .click();
    await page.getByLabel("Question text").fill("Lunch on Friday");
    await waitForSaved(page);
    await expect(page.getByLabel("Form name")).toHaveValue("Lunch poll (internal)");
  } finally {
    await deleteUser(user.userId);
  }
});

test("publishing with starter wording says so and jumps to it; republish offers the link", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const user = await createConfirmedUser("e2e-speed2");
  try {
    await loginViaUI(page, user.email, user.password);
    await page.getByRole("button", { name: "New form" }).first().click();
    await page.waitForURL(/\/forms\/[0-9a-f-]{36}$/);
    await expect(page.getByLabel("Question text")).toBeFocused();
    await page.keyboard.type("Quick poll");
    await page.getByRole("button", { name: "Add question" }).click();
    await page.getByRole("button", { name: /^Multiple choice/ }).click();
    await waitForSaved(page);

    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByText("One question still has starter wording")).toBeVisible({
      timeout: 15000,
    });
    // From anywhere in the builder, "Show me" opens the unfinished question.
    await page
      .getByRole("button", { name: /Quick poll/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Show me" }).click();
    await expect(page.getByLabel("Question text")).toHaveValue("Pick one");

    // A later publish doesn't touch the clipboard; it offers the link.
    await page.evaluate(() => navigator.clipboard.writeText("something else"));
    await page.getByLabel("Question text").fill("Tea or coffee?");
    await page.getByRole("textbox", { name: "Option 1" }).fill("Tea");
    await page.getByRole("textbox", { name: "Option 2" }).fill("Coffee");
    await waitForSaved(page);
    await page.getByRole("button", { name: "Publish changes" }).click();
    await expect(page.getByText("Republished.", { exact: true })).toBeVisible({
      timeout: 15000,
    });
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "something else",
    );
    await page.getByRole("button", { name: "Copy link" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
      /\/f\/[a-z0-9-]+$/,
    );
  } finally {
    await deleteUser(user.userId);
  }
});

test("the dashboard's response count goes straight to the responses", async ({
  page,
  request,
}) => {
  const user = await createConfirmedUser("e2e-speed3");
  const schema: FormSchemaV1 = {
    schemaVersion: 1,
    meta: { title: "Counted" },
    theme: {
      primaryColor: "#1f1f1f",
      backgroundColor: "#ffffff",
      fontFamily: "inter",
      buttonStyle: "rounded",
    },
    endings: [{ id: "end", title: "Thanks", isDefault: true }],
    questions: [
      {
        id: "q1",
        type: "short_text",
        order: 0,
        label: "Name",
        required: true,
        settings: {},
      },
    ],
    logic: [],
  };
  try {
    const { formId } = await createPublishedForm(user, schema);
    const { responseId } = await (
      await request.post("/api/responses/start", { data: { formId } })
    ).json();
    await request.post(`/api/responses/${responseId}/complete`, {
      data: {
        clientRevision: 1,
        lastQuestionId: "q1",
        answers: { q1: "Ada" },
        idempotencyKey: crypto.randomUUID(),
      },
    });
    await loginViaUI(page, user.email, user.password);
    await page.getByRole("link", { name: "1 response" }).click();
    await page.waitForURL(`**/forms/${formId}/responses`);
    await expect(page.getByRole("cell", { name: "Ada" })).toBeVisible();
  } finally {
    await deleteUser(user.userId);
  }
});
