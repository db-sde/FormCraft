import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
} from "./helpers";

/**
 * The central plan check in the builder (QA run 15): a draft using a
 * feature its plan lacks says so as soon as it's opened, and the warning
 * goes once the plan includes it.
 */
const schema = {
  schemaVersion: 1,
  meta: { title: "Plan check" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    {
      id: "q1",
      type: "long_text",
      order: 0,
      label: "Tell us more",
      required: false,
      settings: { aiFollowUp: true },
    },
  ],
  logic: [],
} as unknown as FormSchemaV1;

test("the builder warns about paid features before publishing", async ({ page }) => {
  const user = await createConfirmedUser("e2e-plan-check");
  try {
    const { formId } = await createPublishedForm(user, schema);
    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}`);
    const warning = page
      .getByRole("status")
      .filter({ hasText: "AI follow-up questions" });
    await expect(warning).toBeVisible();
    await expect(warning).toContainText("Available on Starter and up.");
    await expect(warning.getByRole("link", { name: "See plans" })).toHaveAttribute(
      "href",
      "/settings?tab=plan",
    );

    await adminClient()
      .from("workspaces")
      .update({ plan_id: "starter" })
      .eq("owner_id", user.userId);
    await page.reload();
    await expect(page.getByText("Tell us more").first()).toBeVisible();
    await expect(page.getByText(/AI follow-up questions, which/)).toHaveCount(0);
  } finally {
    await deleteUser(user.userId);
  }
});
