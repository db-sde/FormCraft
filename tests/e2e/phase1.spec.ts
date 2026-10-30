import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { setKioskPin } from "@/domains/forms/kiosk";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
} from "./helpers";

/**
 * Master spec Phase 1 through the running app: the classic layout with
 * every new question type, link prefill, custom CSS, kiosk mode and
 * shared question blocks.
 */
const theme = {
  primaryColor: "#1d4ed8",
  backgroundColor: "#ffffff",
  fontFamily: "inter",
  buttonStyle: "rounded",
} as const;

function classicSchema(): FormSchemaV1 {
  return {
    schemaVersion: 1,
    meta: { title: "Event sign-up", layout: "classic" },
    theme: { ...theme, customCss: ".fc-question-label { letter-spacing: 0.05em; }" },
    endings: [{ id: "end", title: "You're registered", isDefault: true }],
    logic: [],
    questions: [
      {
        id: "q_name",
        type: "short_text",
        order: 0,
        label: "Your name",
        required: true,
        prefillKey: "name",
        settings: {},
      },
      {
        id: "pb1",
        type: "page_break",
        order: 1,
        label: "Preferences",
        required: false,
        settings: {},
      },
      {
        id: "q_pic",
        type: "single_select",
        order: 2,
        label: "Pick a colour",
        required: false,
        settings: {
          layout: "pictures",
          allowOther: false,
          options: [
            { id: "o_red", label: "Red" },
            { id: "o_blue", label: "Blue" },
          ],
        },
      },
      {
        id: "q_rank",
        type: "ranking",
        order: 3,
        label: "Rank the talks",
        required: true,
        settings: {
          rankCount: 2,
          options: [
            { id: "r_a", label: "Design" },
            { id: "r_b", label: "Data" },
            { id: "r_c", label: "Security" },
          ],
        },
      },
      {
        id: "q_mx",
        type: "matrix",
        order: 4,
        label: "Rate last year",
        required: true,
        settings: {
          multiple: false,
          rows: [
            { id: "row_v", label: "Venue" },
            { id: "row_f", label: "Food" },
          ],
          columns: [
            { id: "c_bad", label: "Poor" },
            { id: "c_ok", label: "Fine" },
            { id: "c_good", label: "Great" },
          ],
        },
      },
      {
        id: "pb2",
        type: "page_break",
        order: 5,
        label: "Details",
        required: false,
        settings: {},
      },
      {
        id: "q_addr",
        type: "address",
        order: 6,
        label: "Billing address",
        required: true,
        settings: {
          fields: ["line1", "city", "country"],
          requiredFields: ["line1", "country"],
        },
      },
      {
        id: "q_time",
        type: "time",
        order: 7,
        label: "Arrival time",
        required: true,
        settings: {
          minTime: "09:00",
          maxTime: "12:00",
          stepMinutes: 30,
          hourCycle: "12",
        },
      },
    ],
  } as FormSchemaV1;
}

async function answers(formId: string) {
  const { data } = await adminClient()
    .from("answers")
    .select("question_id, value, responses!inner(form_id, status)")
    .eq("responses.form_id", formId)
    .eq("responses.status", "completed");
  return Object.fromEntries((data ?? []).map((a) => [a.question_id, a.value]));
}

test.describe("phase 1", () => {
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;
  test.beforeEach(async () => {
    user = await createConfirmedUser("e2e-phase1");
  });
  test.afterEach(async () => {
    await deleteUser(user.userId);
  });

  test("a classic form: pages, every new type, link prefill and custom CSS", async ({
    page,
  }) => {
    const { formId, liveLink } = await createPublishedForm(user, classicSchema());
    await page.goto(`${liveLink}?name=Grace&utm_source=newsletter`);

    // Page 1: filled from the link, which then leaves the address bar.
    await expect(page.getByRole("textbox", { name: "Your name" })).toHaveValue("Grace");
    await expect(page).toHaveURL(/\?utm_source=newsletter$/);
    // The creator's CSS applies inside the form only.
    await expect(page.locator(".fc-question-label").first()).toHaveCSS(
      "letter-spacing",
      /px/,
    );
    await page.getByRole("button", { name: "Next" }).click();

    // Page 2: required questions hold the page.
    await expect(page.getByRole("heading", { name: "Preferences" })).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(
      page.getByText("This question requires an answer.").first(),
    ).toBeVisible();
    await page.getByRole("radio", { name: /Blue/ }).click();
    await page.getByRole("button", { name: "Security" }).click();
    await page.getByRole("button", { name: "Design" }).click();
    await page.getByRole("button", { name: "Move Design up" }).click();
    await page.getByRole("radio", { name: "Venue: Great" }).check();
    await page.getByRole("radio", { name: "Food: Fine" }).check();
    await page.getByRole("button", { name: "Next" }).click();

    // Page 3, then back and forward keeps answers.
    await expect(page.getByRole("heading", { name: "Details" })).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("radio", { name: "Venue: Great" })).toBeChecked();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByLabel("Address line 1").fill("1 Harbour St");
    await page.getByLabel("Country").fill("Australia");
    await page.getByLabel("Arrival time: hour").selectOption("10");
    await page.getByLabel("Arrival time: minute").selectOption("30");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByRole("heading", { name: "You're registered" })).toBeVisible();

    await expect
      .poll(() => answers(formId))
      .toMatchObject({
        q_name: "Grace",
        q_pic: "o_blue",
        q_rank: ["r_a", "r_c"],
        q_mx: { row_v: "c_good", row_f: "c_ok" },
        q_addr: { line1: "1 Harbour St", country: "Australia" },
        q_time: "10:30",
      });
  });

  test("the same questions one at a time, with a jump to a page break skipped over", async ({
    page,
  }) => {
    const schema = classicSchema();
    const { formId, liveLink } = await createPublishedForm(user, {
      ...schema,
      meta: { title: "One at a time" },
      theme,
      questions: schema.questions.filter(
        (q) => q.id === "q_name" || q.id === "pb1" || q.id === "q_rank",
      ),
    });
    await page.goto(liveLink);
    await page.getByRole("textbox").fill("Lin");
    await page.keyboard.press("Enter");
    // The page break is never a step.
    await expect(page.getByRole("heading", { name: /Rank the talks/ })).toBeVisible();
    await page.getByRole("button", { name: "Data" }).click();
    await page.getByRole("button", { name: "Security" }).click();
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("You're registered")).toBeVisible();
    await expect.poll(() => answers(formId)).toMatchObject({ q_rank: ["r_b", "r_c"] });
  });

  test("kiosk mode starts over after each person, and its exit needs the PIN", async ({
    page,
    request,
  }) => {
    const { formId, liveLink } = await createPublishedForm(user, {
      ...classicSchema(),
      meta: { title: "Lobby check-in" },
      theme,
      questions: [
        {
          id: "q_name",
          type: "short_text",
          order: 0,
          label: "Your name",
          required: true,
          settings: {},
        },
      ],
    });
    // Without kiosk mode on, ?kiosk=1 is just the form.
    await page.goto(`${liveLink}?kiosk=1`);
    await expect(page.getByRole("textbox", { name: "Your name" })).toBeVisible();

    await adminClient()
      .from("forms")
      .update({ kiosk_config: { resetSeconds: 3, idleSeconds: 60 } })
      .eq("id", formId);
    await setKioskPin(adminClient(), formId, "2468");
    await page.goto(`${liveLink}?kiosk=1`);
    await page.getByRole("button", { name: "Start kiosk" }).click();
    await page.getByRole("textbox", { name: "Your name" }).fill("First visitor");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("You're registered")).toBeVisible();
    // A few seconds later: a fresh, empty form for the next person.
    await expect(page.getByRole("textbox", { name: "Your name" })).toHaveValue("", {
      timeout: 8000,
    });
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).filter((k) => k.startsWith("fc-")),
      ),
    ).toEqual(expect.not.arrayContaining([expect.stringContaining("response")]));

    const wrong = await request.post("/api/responses/kiosk-exit", {
      data: { formId, pin: "1111" },
    });
    expect(wrong.status()).toBe(401);
    await page.getByRole("button", { name: "Exit kiosk mode" }).click();
    await page.getByLabel("PIN").fill("2468");
    await page.getByRole("button", { name: "Exit", exact: true }).click();
    await expect(page).not.toHaveURL(/kiosk=1/);
  });

  test("a question saved as a shared block is locked in the form and takes a new version on review", async ({
    page,
  }) => {
    const { formId } = await createPublishedForm(user, {
      ...classicSchema(),
      meta: { title: "Uses a block" },
      theme,
      questions: [
        {
          id: "q_consent",
          type: "yes_no",
          order: 0,
          label: "Do you agree to the terms?",
          required: true,
          settings: {},
        },
      ],
    });
    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}`);
    await page
      .getByRole("button", { name: /Do you agree to the terms/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Save to block library" }).click();
    await page
      .getByRole("dialog")
      .getByLabel("Name", { exact: true })
      .fill("Terms consent");
    await page.getByRole("button", { name: "Save block" }).click();
    await expect(page.getByTestId("block-notice")).toContainText("Terms consent");

    // The draft now holds a locked copy of the block (saved by autosave).
    await expect
      .poll(
        async () => {
          const { data } = await adminClient()
            .from("form_versions")
            .select("schema")
            .eq("form_id", formId)
            .eq("status", "draft")
            .single();
          return (data?.schema as FormSchemaV1).questions[0]?.block?.version;
        },
        { timeout: 15000 },
      )
      .toBe(1);
    const { data: block } = await adminClient()
      .from("question_blocks")
      .select("id")
      .eq("name", "Terms consent")
      .single();
    await page.goto(`/blocks/${block!.id}`);
    await page.getByLabel("Question 1 text").fill("Do you accept the event terms?");
    await page.getByRole("button", { name: "Publish version 2" }).click();
    await expect(page.getByText("Version 2 published.")).toBeVisible();

    // The form isn't changed until its editor applies the update.
    await page.goto(`/forms/${formId}`);
    await page
      .getByRole("button", { name: /Do you agree to the terms/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Version 2 available: review" }).click();
    await expect(page.getByText(/Changed:/)).toBeVisible();
    await page.getByRole("button", { name: "Apply to draft" }).click();
    await expect(
      page.getByRole("button", { name: /Do you accept the event terms/ }).first(),
    ).toBeVisible();
  });
});
