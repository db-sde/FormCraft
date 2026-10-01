import { test, expect } from "@playwright/test";
import type { Json } from "@/lib/supabase/database.types";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
} from "./helpers";

/**
 * Creator-side behaviours that used to be quietly wrong: the Share
 * page claiming lead capture works when it doesn't, filters dropping
 * your search, the phone menu trapping neither focus nor Escape, and
 * logic that could send respondents backwards.
 */
const theme = {
  primaryColor: "#4f46e5",
  backgroundColor: "#ffffff",
  fontFamily: "inter",
  buttonStyle: "rounded",
} as const;

const withContact: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Quote request" },
  theme,
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
      type: "long_text",
      order: 1,
      label: "Need?",
      required: false,
      settings: {},
    },
  ],
  logic: [],
};

test.describe("share page: lead capture status tells the truth", () => {
  test("on, then limited once unfinished responses stop being saved", async ({
    page,
  }) => {
    const user = await createConfirmedUser("e2e-share");
    try {
      const { formId } = await createPublishedForm(user, withContact);
      await loginViaUI(page, user.email, user.password);

      await page.goto(`/forms/${formId}/share`);
      await expect(
        page.getByRole("heading", { name: "Lead capture is on" }),
      ).toBeVisible();

      await adminClient()
        .from("forms")
        .update({ save_partial_responses: false })
        .eq("id", formId);
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "Lead capture is limited" }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "Open settings" })).toBeVisible();
    } finally {
      await deleteUser(user.userId);
    }
  });

  test("a contact step that exists only in the draft isn't reported as live", async ({
    page,
  }) => {
    const user = await createConfirmedUser("e2e-share-draft");
    try {
      const withoutContact: FormSchemaV1 = {
        ...withContact,
        questions: [{ ...withContact.questions[1], order: 0 }],
      };
      const { formId } = await createPublishedForm(user, withoutContact);
      await adminClient()
        .from("form_versions")
        .update({ schema: withContact as unknown as Json })
        .eq("form_id", formId)
        .eq("status", "draft");

      await loginViaUI(page, user.email, user.password);
      await page.goto(`/forms/${formId}/share`);
      await expect(
        page.getByRole("heading", { name: /set up, but not live yet/ }),
      ).toBeVisible();
    } finally {
      await deleteUser(user.userId);
    }
  });
});

test("leads: choosing a form keeps what you searched for", async ({ page }) => {
  const user = await createConfirmedUser("e2e-filter");
  try {
    await createPublishedForm(user, withContact);
    await loginViaUI(page, user.email, user.password);
    await page.goto("/leads?q=grace&page=2");
    await page.getByRole("combobox", { name: "Filter by form" }).click();
    await page.getByRole("option", { name: "Quote request" }).click();
    await expect(page).toHaveURL(/form=[0-9a-f-]{36}/);
    const params = new URL(page.url()).searchParams;
    expect(params.get("q")).toBe("grace");
    // A filter change starts back on the first page.
    expect(params.get("page")).toBeNull();
  } finally {
    await deleteUser(user.userId);
  }
});

test.describe("phone menu", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("closes on Escape, keeps focus inside, and gives focus back", async ({ page }) => {
    const user = await createConfirmedUser("e2e-drawer");
    try {
      await loginViaUI(page, user.email, user.password);
      const open = page.getByRole("button", { name: "Open menu" });
      await open.click();

      const drawer = page.getByRole("dialog", { name: "Menu" });
      await expect(drawer).toBeVisible();

      // Tab a few more times than there are controls: focus must never
      // leave the drawer for the page behind it.
      for (let i = 0; i < 12; i += 1) {
        await page.keyboard.press("Tab");
        const inside = await page.evaluate(
          () => !!document.activeElement?.closest('[role="dialog"]'),
        );
        expect(inside, `focus escaped the menu on Tab ${i + 1}`).toBe(true);
      }

      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
      await expect(open).toBeFocused();
    } finally {
      await deleteUser(user.userId);
    }
  });
});

test.describe("logic editor only lets rules jump forward", () => {
  const threeQuestions: FormSchemaV1 = {
    ...withContact,
    meta: { title: "Branching" },
    questions: ["First", "Second", "Third"].map((label, order) => ({
      id: `q_${label.toLowerCase()}`,
      type: "short_text" as const,
      order,
      label,
      required: false,
      settings: {},
    })),
  };

  test("the jump-to list stops at the question the rule is on", async ({ page }) => {
    const user = await createConfirmedUser("e2e-logic");
    try {
      const { formId } = await createPublishedForm(user, threeQuestions);
      await loginViaUI(page, user.email, user.password);
      await page.goto(`/forms/${formId}`);

      await page.getByRole("button", { name: /^Logic/ }).click();
      await page.getByRole("button", { name: "Add rule" }).click();
      // New rules start on the first question; make this one jump to a question.
      await page.getByRole("combobox").nth(2).click();
      await page.getByRole("option", { name: "Jump to question" }).click();
      await page.getByRole("combobox").nth(3).click();

      await expect(page.getByRole("option", { name: "Second" })).toBeVisible();
      await expect(page.getByRole("option", { name: "Third" })).toBeVisible();
      await expect(page.getByRole("option", { name: "First" })).toHaveCount(0);
    } finally {
      await deleteUser(user.userId);
    }
  });

  test("a backward jump in a saved draft is explained, not saved", async ({ page }) => {
    const user = await createConfirmedUser("e2e-logic-back");
    try {
      const { formId } = await createPublishedForm(user, threeQuestions);
      // A draft that already has a backward jump (from before the rule).
      await adminClient()
        .from("form_versions")
        .update({
          schema: {
            ...threeQuestions,
            logic: [
              {
                id: "back",
                questionId: "q_third",
                operator: "is_answered",
                action: { type: "jump_to_question", questionId: "q_first" },
              },
            ],
          } as unknown as Json,
        })
        .eq("form_id", formId)
        .eq("status", "draft");

      await loginViaUI(page, user.email, user.password);
      await page.goto(`/forms/${formId}`);
      await page.getByRole("button", { name: /^Logic/ }).click();
      // Touch the form so autosave runs its check.
      await page.getByRole("button", { name: "Add rule" }).click();
      await expect(
        page.getByText(/Logic rule 1: jumps back to an earlier question/),
      ).toBeVisible({
        timeout: 15000,
      });
    } finally {
      await deleteUser(user.userId);
    }
  });
});
