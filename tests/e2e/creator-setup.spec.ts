import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { saveCredential } from "@/domains/integrations/credentials";
import {
  addQuestion,
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
  waitForSaved,
} from "./helpers";

/**
 * The creator-side setup screens of the master-spec features, driven
 * through the UI (the respondent side has its own specs): booking types
 * and the Booking question, payment settings and coupons, notification
 * rules, the embed allowlist, and the Razorpay connection form. Found by
 * a full walk-through on 2026-11-03: leaving the builder to create a
 * booking type lost the question, and switching a coupon off failed.
 */
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Creator setup" },
  theme: {
    primaryColor: "#1d4ed8",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  logic: [],
  questions: [
    {
      id: "q_email",
      type: "email",
      order: 0,
      label: "Your email",
      required: true,
      settings: {},
    },
    {
      id: "q_score",
      type: "number",
      order: 1,
      label: "Team size",
      required: false,
      settings: {},
    },
  ],
};

test.describe("creator setup screens", () => {
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;
  let formId: string;
  let liveLink: string;
  let workspaceId: string;

  test.beforeEach(async () => {
    user = await createConfirmedUser("e2e-setup");
    ({ formId, liveLink } = await createPublishedForm(user, schema));
    const admin = adminClient();
    const { data } = await admin
      .from("forms")
      .select("workspace_id")
      .eq("id", formId)
      .single();
    workspaceId = data!.workspace_id;
    await admin.from("workspaces").update({ plan_id: "business" }).eq("id", workspaceId);
  });
  test.afterEach(async () => {
    await deleteUser(user.userId);
  });

  test("a Booking question waits in the builder while its booking type is made in another tab", async ({
    page,
    context,
  }) => {
    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}`);
    await addQuestion(page, "Booking");
    // The way to make one opens beside the builder, so the question stays.
    const setUp = page.getByRole("link", { name: "Set one up" });
    await expect(setUp).toHaveAttribute("target", "_blank");

    const bookings = await context.newPage();
    await bookings.goto("/bookings");
    await bookings.getByRole("button", { name: "New booking type" }).click();
    await bookings.getByLabel("Name", { exact: true }).fill("Discovery call");
    await bookings.getByRole("button", { name: "Save booking type" }).click();
    await expect(bookings.getByText(/^Discovery call$/)).toBeVisible();
    await bookings.close();

    // Back in the builder, the new type is offered without a reload.
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    const picker = page.getByLabel("Booking type", { exact: true });
    await expect(picker.locator("option", { hasText: "Discovery call" })).toHaveCount(1);
    await picker.selectOption({ label: "Discovery call" });
    await page.getByLabel("Attendee's email from").selectOption("q_email");
    await waitForSaved(page);
    const { data: draft } = await adminClient()
      .from("form_versions")
      .select("schema")
      .eq("form_id", formId)
      .eq("status", "draft")
      .single();
    const booking = (draft!.schema as unknown as FormSchemaV1).questions.find(
      (q) => q.type === "booking",
    );
    expect(booking?.settings).toMatchObject({
      bookingTypeId: expect.any(String),
      emailQuestionId: "q_email",
    });
  });

  test("payment settings and coupons: add, switch off, delete", async ({ page }) => {
    await saveCredential(
      adminClient(),
      workspaceId,
      "razorpay",
      {
        keyId: "rzp_test_e2eSetup0001",
        keySecret: "e2eSetupSecret12345",
        webhookSecret: "hook",
      },
      "rzp_test_e2eSetup0001 (test mode)",
    );
    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}/integrations`);
    await page.getByLabel("Take a payment when people submit").check();
    // Razorpay takes INR only: the currency is fixed.
    await expect(page.getByRole("combobox", { name: "Currency" })).toBeDisabled();
    await page.getByLabel("Amount", { exact: true }).fill("499");
    await page.getByLabel("What they're paying for").fill("Workshop seat");
    await page
      .locator("form")
      .filter({ hasText: "Take a payment when people submit" })
      .getByRole("button", { name: "Save" })
      .click();
    await expect(page.getByText("Payment saved.")).toBeVisible();

    await page.getByRole("button", { name: "Add a coupon" }).click();
    await page.getByLabel("Code").fill("save10");
    await page.getByLabel("Percent off").fill("10");
    await page.getByRole("button", { name: "Add coupon" }).click();
    await expect(page.getByText("Coupon added.")).toBeVisible();
    const admin = adminClient();
    const coupon = () =>
      admin.from("coupons").select("code, percent_off, active").eq("form_id", formId);
    await expect
      .poll(async () => (await coupon()).data)
      .toEqual([{ code: "SAVE10", percent_off: 10, active: true }]);

    // Switching it off saves (it used to fail: the update sent a column
    // editors may not change).
    await page.getByRole("switch", { name: "SAVE10 on" }).click();
    await expect.poll(async () => (await coupon()).data?.[0]?.active).toBe(false);
    await expect(page.getByText("Couldn't save the coupon")).toHaveCount(0);

    await page.getByRole("button", { name: "Delete SAVE10" }).click();
    await expect.poll(async () => (await coupon()).data).toEqual([]);

    const { data: form } = await admin
      .from("forms")
      .select("payment_config")
      .eq("id", formId)
      .single();
    expect(form?.payment_config).toMatchObject({
      provider: "razorpay",
      amount: 499,
      currency: "inr",
      description: "Workshop seat",
    });
  });

  test("a notification rule is saved for a teammate, and emails them on a response", async ({
    page,
    browser,
  }) => {
    test.skip(!process.env.RESEND_BASE_URL, "needs the suite's stand-in email API");
    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}/integrations`);
    await page.getByRole("button", { name: "Add a rule" }).click();
    await page.locator("#rule-new-name").fill("Big teams");
    await page.locator("#rule-new-subject").fill(`Rule alert ${formId.slice(0, 8)}`);
    await page
      .getByRole("group", { name: "Teammates" })
      .getByRole("checkbox")
      .first()
      .check();
    await page.getByRole("button", { name: "Save rule" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await expect
      .poll(async () => {
        const { data } = await adminClient()
          .from("notification_rules")
          .select("name, enabled")
          .eq("form_id", formId);
        return data;
      })
      .toEqual([{ name: "Big teams", enabled: true }]);

    // A response comes in: the rule emails its teammate (the owner).
    const visitor = await browser.newContext();
    const respondent = await visitor.newPage();
    await respondent.goto(liveLink);
    await respondent.getByRole("textbox").fill("lead@example.com");
    await respondent.keyboard.press("Enter");
    await respondent.getByRole("button", { name: "Submit" }).click();
    await expect(respondent.getByRole("heading", { name: "Thanks" })).toBeVisible();
    await visitor.close();
    await expect
      .poll(
        async () => {
          const sent = (await (
            await fetch(`${process.env.RESEND_BASE_URL}/sent`)
          ).json()) as { to: string[] | string; subject: string }[];
          return sent.some(
            (m) =>
              m.subject === `Rule alert ${formId.slice(0, 8)}` &&
              [m.to].flat().includes(user.email.toLowerCase()),
          );
        },
        { timeout: 20_000 },
      )
      .toBe(true);
  });

  test("only the listed sites may embed the form", async ({ page }) => {
    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}/share`);
    await page.getByText("Only these websites").click();
    const sites = page.getByLabel("Websites, one per line");
    const save = page
      .locator("form")
      .filter({ hasText: "Where it can be embedded" })
      .getByRole("button", { name: "Save" });

    await sites.fill("javascript:alert(1)");
    await save.click();
    await expect(page.getByText(/isn't a website address/)).toBeVisible();

    await sites.fill("acme.com/pricing\nhttps://partner.example");
    await save.click();
    await expect(page.getByText("Only those sites can embed it now.")).toBeVisible();
    await expect(sites).toHaveValue("https://acme.com\nhttps://partner.example");

    const res = await page.request.get(liveLink);
    expect(res.headers()["content-security-policy"]).toContain(
      "frame-ancestors 'self' https://acme.com https://partner.example",
    );
  });

  test("Settings → Connections: Razorpay's form checks keys before saving", async ({
    page,
  }) => {
    await loginViaUI(page, user.email, user.password);
    await page.goto("/settings?tab=connections");
    await expect(page.getByRole("heading", { name: "Razorpay" })).toBeVisible();
    await expect(page.getByText(`/api/payments/razorpay/${workspaceId}`)).toBeVisible();
    await page.getByLabel("Key id").fill("not-a-key");
    await page.getByLabel("Key secret").fill("x".repeat(20));
    await page.getByLabel("Webhook secret").fill("hook-secret");
    await page.getByRole("button", { name: "Connect Razorpay" }).click();
    await expect(page.getByText(/Paste a Razorpay key id/)).toBeVisible();
    const { data } = await adminClient()
      .from("integration_credentials")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("provider", "razorpay");
    expect(data).toEqual([]);
  });
});
