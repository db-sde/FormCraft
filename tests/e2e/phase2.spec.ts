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
 * Master spec Phase 2 through the running app: a respondent orders
 * products and signs; the creator sees the server-priced order, the
 * signature and the timeline, sets a status and assignee, comments, and
 * filters the list. Import refuses a link it can't use.
 */
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Merch order" },
  theme: {
    primaryColor: "#1d4ed8",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "Order received", isDefault: true }],
  logic: [],
  questions: [
    {
      id: "q_items",
      type: "products",
      order: 0,
      label: "What would you like?",
      required: true,
      settings: {
        currency: "USD",
        items: [
          { id: "tee", label: "T-shirt", price: 1999, maxQuantity: 3 },
          { id: "mug", label: "Mug", price: 850 },
        ],
      },
    },
    {
      id: "q_sign",
      type: "signature",
      order: 1,
      label: "Sign to confirm",
      required: true,
      settings: { consentText: "I agree to pay on delivery." },
    },
  ],
};

test.describe("phase 2", () => {
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;
  test.beforeEach(async () => {
    user = await createConfirmedUser("e2e-phase2");
  });
  test.afterEach(async () => {
    await deleteUser(user.userId);
  });

  test("order and signature, then the record: status, assignee, comment, timeline", async ({
    page,
  }) => {
    const { formId, liveLink } = await createPublishedForm(user, schema);
    await page.goto(liveLink);

    // Products: quantities, a limit, and a running total.
    await page.getByRole("button", { name: "One more T-shirt" }).click();
    await page.getByRole("button", { name: "One more T-shirt" }).click();
    await page.getByRole("button", { name: "One more Mug" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Total" })).toContainText(
      "$48.48",
    );
    await page.getByRole("button", { name: "One more T-shirt" }).click();
    await expect(page.getByRole("button", { name: "One more T-shirt" })).toBeDisabled();
    await page.getByRole("button", { name: "One fewer T-shirt" }).click();
    await page.getByRole("button", { name: "OK" }).click();

    // Signature: required, then drawn.
    await expect(page.getByText("I agree to pay on delivery.")).toBeVisible();
    const pad = page.getByRole("img", { name: /Signature pad/ });
    const box = (await pad.boundingBox())!;
    await page.mouse.move(box.x + 30, box.y + box.height * 0.6);
    await page.mouse.down();
    for (let i = 1; i <= 12; i += 1) {
      await page.mouse.move(
        box.x + 30 + i * 25,
        box.y + box.height * (0.6 - (i % 2) * 0.2),
      );
    }
    await page.mouse.up();
    await expect(page.getByText("Signature saved")).toBeVisible();
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByRole("heading", { name: "Order received" })).toBeVisible();

    const admin = adminClient();
    const { data: response } = await admin
      .from("responses")
      .select("id")
      .eq("form_id", formId)
      .eq("status", "completed")
      .single();
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("response_orders")
          .select("total_amount")
          .eq("response_id", response!.id)
          .maybeSingle();
        return data?.total_amount;
      })
      .toBe(2 * 1999 + 850);

    // The creator's view of it.
    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}/responses/${response!.id}`);
    await expect(page.getByRole("heading", { name: "Order" })).toBeVisible();
    await expect(page.getByText("2 × T-shirt").first()).toBeVisible();
    await expect(page.getByRole("img", { name: /Signature for/ })).toBeVisible();
    await expect(page.getByText(/not certified/)).toBeVisible();
    const timeline = page.getByRole("region", { name: "Timeline" });
    await expect(timeline.getByText("Started")).toBeVisible();
    await expect(timeline.getByText("Submitted")).toBeVisible();

    await page.getByLabel("Status").click();
    await page.getByRole("option", { name: "In progress" }).click();
    await expect(timeline.getByText("Status set to In progress")).toBeVisible();
    await page.getByLabel("Assignee").click();
    await page
      .getByRole("option", { name: /e2e-phase2|@/ })
      .first()
      .click();
    await expect(timeline.getByText(/Assigned to/)).toBeVisible();

    await page.getByLabel("Add a comment").fill("Ship with the next batch.");
    await page.getByRole("button", { name: "Comment" }).click();
    await expect(
      page
        .getByRole("region", { name: "Internal comments" })
        .getByText("Ship with the next batch."),
    ).toBeVisible();

    // The list filters by status.
    await page.goto(`/forms/${formId}/responses?status=in_progress`);
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page.goto(`/forms/${formId}/responses?status=done`);
    await expect(page.getByText("No responses match these filters")).toBeVisible();
  });

  test("import refuses a link it can't use, with what to paste", async ({ page }) => {
    await createPublishedForm(user, schema);
    await loginViaUI(page, user.email, user.password);
    await page.goto("/templates");
    await page.getByLabel(/Import from a link/).fill("https://example.com/my-form");
    await page.getByRole("button", { name: "Import form" }).click();
    await expect(page.getByText(/Paste a public Google Forms link/)).toBeVisible();
  });
});
