import { test, expect, type Page } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
} from "./helpers";

/**
 * Journeys done with the keyboard only — no mouse, no programmatic
 * focus once the page is up. Anyone who can't use a pointer (motor
 * impairment, screen-reader users, plenty of power users) depends on
 * these paths, and they're the first to rot because every other test
 * clicks.
 */
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Keyboard form" },
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
      id: "q_pick",
      type: "single_select",
      order: 1,
      label: "Pick one",
      required: true,
      settings: {
        allowOther: false,
        options: [
          { id: "a", label: "Option A" },
          { id: "b", label: "Option B" },
        ],
      },
    },
    {
      id: "q_last",
      type: "short_text",
      order: 2,
      label: "Anything else?",
      required: false,
      settings: {},
    },
  ],
  logic: [],
};

/** Presses Tab until the focused element has this accessible name. */
async function tabTo(page: Page, name: string | RegExp, limit = 60) {
  for (let i = 0; i < limit; i += 1) {
    await page.keyboard.press("Tab");
    const label = await page.evaluate(() => {
      const el = document.activeElement as HTMLButtonElement | null;
      if (!el) return "";
      // aria-label, else the <label> a radio/checkbox is tied to, else its text.
      const labelled = el.getAttribute("aria-label") ?? el.labels?.[0]?.textContent;
      return (labelled ?? el.textContent ?? "").trim();
    });
    if (typeof name === "string" ? label === name : name.test(label)) return;
  }
  throw new Error(`never reached "${String(name)}" by pressing Tab ${limit} times`);
}

test("a respondent can finish a form without touching the mouse", async ({ page }) => {
  const user = await createConfirmedUser("e2e-kb-respond");
  try {
    const { formId, liveLink } = await createPublishedForm(user, schema);
    await page.goto(liveLink);

    // The first field is ready to type into straight away.
    await expect(page.getByLabel("Name")).toBeFocused();
    await page.keyboard.type("Ada Lovelace");
    await page.keyboard.press("Enter");
    await page.keyboard.type("ada@example.com");
    await page.keyboard.press("Enter");

    // A new question without a text box takes focus itself (its heading),
    // so keyboard and screen-reader users aren't left at the top of the page.
    await expect(page.getByRole("heading", { name: /Pick one/ })).toBeFocused();
    // Reach the options; arrow keys move between them and Space chooses
    // the focused one. (Wait for focus to actually arrive — right after a
    // step appears the page can still be busy, and Space too early would
    // pick option A.)
    await tabTo(page, /Option A/);
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("radio", { name: "Option B" })).toBeFocused();
    await page.keyboard.press("Space");

    await expect(page.getByText("Anything else?")).toBeVisible();
    await page.keyboard.type("all good");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Thanks!")).toBeVisible();

    const { data } = await adminClient()
      .from("answers")
      .select("question_id, value, responses!inner(form_id, status)")
      .eq("responses.form_id", formId);
    expect(data?.map((a) => a.question_id).sort()).toEqual([
      "q_contact",
      "q_last",
      "q_pick",
    ]);
    expect(data?.every((a) => a.responses?.status === "completed")).toBe(true);
    expect(data?.find((a) => a.question_id === "q_pick")?.value).toBe("b");
  } finally {
    await deleteUser(user.userId);
  }
});

test("a creator can add, edit and reorder questions from the keyboard", async ({
  page,
}) => {
  const user = await createConfirmedUser("e2e-kb-build");
  try {
    const { formId } = await createPublishedForm(user, {
      ...schema,
      questions: [schema.questions[2], { ...schema.questions[1], order: 1 }],
    });
    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}`);
    await expect(page.getByText("Anything else?").first()).toBeVisible();

    // Move the first question down using only the keyboard.
    const rows = page.locator("li", { has: page.getByRole("button", { name: /^Move/ }) });
    await expect(rows.first()).toContainText("Anything else?");
    await tabTo(page, 'Move "Anything else?" down');
    await page.keyboard.press("Enter");
    await expect(rows.first()).toContainText("Pick one");
    await expect(rows.nth(1)).toContainText("Anything else?");

    // …and the new order is what got saved.
    await expect
      .poll(async () => {
        const { data } = await adminClient()
          .from("form_versions")
          .select("schema")
          .eq("form_id", formId)
          .eq("status", "draft")
          .single();
        const questions = (data?.schema as unknown as FormSchemaV1).questions;
        return [...questions].sort((a, b) => a.order - b.order).map((q) => q.id);
      })
      .toEqual(["q_pick", "q_last"]);

    // Add a question: open the menu, choose with arrows and Enter.
    await tabTo(page, /Add question/);
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Question text")).toBeVisible();
  } finally {
    await deleteUser(user.userId);
  }
});
