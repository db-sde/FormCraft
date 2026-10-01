import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
} from "./helpers";

/**
 * Regression for a reported bug: a respondent filled in every question
 * and saw the "Thank you" screen, but the response stayed "incomplete"
 * in the dashboard (all answers present, never completed). Cause: the
 * hidden spam-trap field was named like a real field ("website") and a
 * browser/password-manager autofilled it; the server then pretended to
 * succeed without completing anything. These pin the corrected
 * behaviour: whatever the browser does to hidden fields, and however
 * long the respondent idles, a submitted form ends up completed.
 */
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Integrity" },
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
      settings: { fields: ["name", "email"], requiredFields: ["name", "email"] },
    },
    {
      id: "q_last",
      type: "short_text",
      order: 1,
      label: "Last one",
      required: true,
      settings: {},
    },
  ],
  logic: [],
};

async function statusFor(formId: string) {
  const { data } = await adminClient()
    .from("responses")
    .select("status, spam_suspected")
    .eq("form_id", formId);
  return data ?? [];
}

test("an autofilled hidden field never costs a person their submission", async ({
  page,
}) => {
  const user = await createConfirmedUser("e2e-integrity");
  try {
    const { formId, liveLink } = await createPublishedForm(user, schema);
    await page.goto(liveLink);
    await page.getByLabel("Name").fill("Ada Lovelace");
    await page.getByLabel("Email").fill("ada@example.com");

    // Simulate a browser/password manager filling the hidden field.
    await page.evaluate(() => {
      const trap = document.querySelector<HTMLInputElement>('input[name="zq7_hp"]');
      if (!trap) throw new Error("spam trap field missing");
      const set = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      set.call(trap, "https://autofilled.example");
    });
    await page.getByRole("button", { name: "OK" }).click();
    await page.getByRole("textbox").fill("done");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("Thanks!")).toBeVisible();

    // What the creator sees: completed, with every answer — flagged,
    // not lost and not left "incomplete".
    await expect
      .poll(() => statusFor(formId))
      .toEqual([{ status: "completed", spam_suspected: true }]);
  } finally {
    await deleteUser(user.userId);
  }
});

test("idling for a long time mid-form still completes", async ({ page }) => {
  const user = await createConfirmedUser("e2e-idle");
  try {
    const { formId, liveLink } = await createPublishedForm(user, schema);
    await page.clock.install();
    await page.goto(liveLink);
    await page.getByLabel("Name").fill("Grace Hopper");
    await page.getByLabel("Email").fill("grace@example.com");
    await page.getByRole("button", { name: "OK" }).click();
    await expect(page.getByText("Last one")).toBeVisible();

    // Walk away for 45 minutes (past the 30-minute abandonment mark),
    // then come back and finish.
    await page.clock.fastForward("45:00");
    await page.getByRole("textbox").fill("back again");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("Thanks!")).toBeVisible();

    await expect
      .poll(() => statusFor(formId))
      .toEqual([{ status: "completed", spam_suspected: false }]);
    const { data: answers } = await adminClient()
      .from("answers")
      .select("question_id, response_id, responses!inner(form_id)")
      .eq("responses.form_id", formId);
    expect(answers?.map((a) => a.question_id).sort()).toEqual(["q_contact", "q_last"]);
  } finally {
    await deleteUser(user.userId);
  }
});

test("submitting while slow autosaves are still in flight completes", async ({
  page,
}) => {
  const user = await createConfirmedUser("e2e-inflight");
  try {
    const { formId, liveLink } = await createPublishedForm(user, schema);
    await page.route("**/api/responses/*/answers", async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });
    await page.goto(liveLink);
    await page.getByLabel("Name").fill("Alan Turing");
    await page.getByLabel("Email").fill("alan@example.com");
    await page.getByRole("button", { name: "OK" }).click();
    await page.getByRole("textbox").fill("quick");
    // Submit immediately — saves are still crawling.
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("Thanks!")).toBeVisible({ timeout: 15000 });
    await expect
      .poll(() => statusFor(formId))
      .toEqual([{ status: "completed", spam_suspected: false }]);
  } finally {
    await deleteUser(user.userId);
  }
});
