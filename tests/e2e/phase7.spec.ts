import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { saveCredential } from "@/domains/integrations/credentials";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
} from "./helpers";

/**
 * Master spec Phase 7 (F-22/F-35) through the running app, against a
 * stand-in Razorpay (its API and its Checkout script): the in-form payment
 * step with a coupon, Checkout's signed result checked on the server
 * before the form's ending shows, a signed webhook (forged ones refused,
 * repeats harmless), and paying later from the payment link.
 */
// playwright.config.ts points the app here (FAKE_RAZORPAY_PORT).
const PORT = 4603;
const SECRET = "e2eRazorpaySecret12345";
const HOOK = "e2e-razorpay-hook";
const orders = new Map<string, number>();
let server: Server;
// One fake server per file: its tests run in one worker, in order.
test.describe.configure({ mode: "serial" });

/** Stands in for checkout.razorpay.com: a "Pay" button that signs the
 * result as Razorpay would (the test secret is known to this fake only). */
const CHECKOUT_JS = `
window.Razorpay = function (options) {
  var on = {};
  this.on = function (name, fn) { on[name] = fn; };
  this.open = function () {
    var box = document.createElement("div");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Fake Razorpay");
    box.style.cssText = "position:fixed;inset:20px;z-index:99;background:#fff;border:2px solid #000;padding:20px";
    var pay = document.createElement("button");
    pay.textContent = "Pay with fake Razorpay";
    var close = document.createElement("button");
    close.textContent = "Close fake Razorpay";
    box.appendChild(pay); box.appendChild(close);
    document.body.appendChild(box);
    close.onclick = function () { box.remove(); options.modal.ondismiss(); };
    pay.onclick = async function () {
      var paymentId = "pay_" + options.order_id.slice(6);
      var key = await crypto.subtle.importKey("raw", new TextEncoder().encode(${JSON.stringify(SECRET)}),
        { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      var sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(options.order_id + "|" + paymentId));
      var hex = Array.from(new Uint8Array(sig)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
      box.remove();
      options.handler({ razorpay_order_id: options.order_id, razorpay_payment_id: paymentId, razorpay_signature: hex });
    };
  };
};`;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const path = new URL(req.url ?? "/", "http://x").pathname;
      if (path === "/checkout.js") {
        res.setHeader("content-type", "text/javascript");
        return res.end(CHECKOUT_JS);
      }
      res.setHeader("content-type", "application/json");
      if (req.method === "POST" && path === "/v1/orders") {
        const { amount } = JSON.parse(raw) as { amount: number };
        const id = `order_E2E${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
        orders.set(id, amount);
        return res.end(
          JSON.stringify({ id, amount, currency: "INR", status: "created" }),
        );
      }
      const pay = /^\/v1\/payments\/pay_(\w+)$/.exec(path);
      const orderId = pay ? `order_${pay[1]}` : "";
      if (pay && orders.has(orderId)) {
        return res.end(
          JSON.stringify({
            id: `pay_${pay[1]}`,
            order_id: orderId,
            amount: orders.get(orderId),
            currency: "INR",
            status: "captured",
          }),
        );
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { description: "not found" } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Masterclass" },
  theme: {
    primaryColor: "#1d4ed8",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "You're in!", isDefault: true }],
  logic: [],
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
};

test.describe("phase 7", () => {
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;
  let formId: string;
  let workspaceId: string;
  let liveLink: string;

  test.beforeEach(async () => {
    user = await createConfirmedUser("e2e-phase7");
    ({ formId, liveLink } = await createPublishedForm(user, schema));
    const admin = adminClient();
    const { data: form } = await admin
      .from("forms")
      .select("workspace_id")
      .eq("id", formId)
      .single();
    workspaceId = form!.workspace_id;
    await admin.from("workspaces").update({ plan_id: "business" }).eq("id", workspaceId);
    await admin
      .from("forms")
      .update({
        payment_config: {
          provider: "razorpay",
          amount: 499,
          amountVariableId: null,
          fromOrder: false,
          currency: "inr",
          description: "Masterclass seat",
        },
      })
      .eq("id", formId);
    await saveCredential(
      admin,
      workspaceId,
      "razorpay",
      { keyId: "rzp_test_e2eFAKEkey01", keySecret: SECRET, webhookSecret: HOOK },
      "rzp_test_e2eFAKEkey01 (test mode)",
    );
    await admin
      .from("coupons")
      .insert({ form_id: formId, code: "SAVE10", kind: "percent", percent_off: 10 });
  });
  test.afterEach(async () => {
    await deleteUser(user.userId);
  });

  test("pay in the form with a coupon; the ending shows once Razorpay's payment is verified", async ({
    page,
  }) => {
    await page.goto(liveLink);
    await page.getByRole("textbox").fill("Asha");
    await page.getByRole("button", { name: "Submit" }).click();

    const step = page.getByRole("dialog", { name: "Payment" });
    await expect(step).toBeVisible();
    await expect(step.getByText("₹499.00").last()).toBeVisible();
    await step.getByLabel("Coupon code").fill("nope");
    await step.getByRole("button", { name: "Apply" }).click();
    await expect(step.getByRole("alert")).toHaveText("That code isn't valid.");
    await step.getByLabel("Coupon code").fill("save10");
    await step.getByRole("button", { name: "Apply" }).click();
    await expect(step.getByText(/Coupon SAVE10 \(10% off\)/)).toBeVisible();

    // Closing Checkout pays nothing; paying shows the form's ending.
    await step.getByRole("button", { name: "Pay ₹449.10" }).click();
    await page.getByRole("button", { name: "Close fake Razorpay" }).click();
    await expect(
      step.getByText("The payment wasn't completed. You can try again."),
    ).toBeVisible();
    await step.getByRole("button", { name: "Pay ₹449.10" }).click();
    await page.getByRole("button", { name: "Pay with fake Razorpay" }).click();
    await expect(page.getByRole("heading", { name: "You're in!" })).toBeVisible();

    const admin = adminClient();
    const { data: payments } = await admin
      .from("payments")
      .select("status, amount, discount, coupon_code, provider, provider_payment_id")
      .eq("form_id", formId);
    expect(payments).toEqual([
      {
        status: "paid",
        amount: 44_910,
        discount: 4990,
        coupon_code: "SAVE10",
        provider: "razorpay",
        provider_payment_id: expect.stringMatching(/^pay_E2E/),
      },
    ]);
    // One order for both tries (the same amount), the coupon used once.
    const { data: attempts } = await admin
      .from("payment_attempts")
      .select("status")
      .eq("form_id", formId);
    expect(attempts).toEqual([{ status: "paid" }]);
    const { data: coupon } = await admin
      .from("coupons")
      .select("uses")
      .eq("form_id", formId)
      .single();
    expect(coupon?.uses).toBe(1);

    // Webhooks: a forged one is refused; Razorpay's own repeat is harmless.
    const { data: attempt } = await admin
      .from("payment_attempts")
      .select("provider_ref, provider_payment_id")
      .eq("form_id", formId)
      .single();
    const body = JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: attempt!.provider_payment_id,
            order_id: attempt!.provider_ref,
            amount: 44_910,
            currency: "INR",
            status: "captured",
          },
        },
      },
    });
    const hook = `/api/payments/razorpay/${workspaceId}`;
    const forged = await page.request.post(hook, {
      data: body,
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": "0".repeat(64),
      },
    });
    expect(forged.status()).toBe(400);
    const signed = await page.request.post(hook, {
      data: body,
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": createHmac("sha256", HOOK).update(body).digest("hex"),
      },
    });
    expect(await signed.json()).toEqual({ received: true, outcome: "ignored" });
  });

  test("finish without paying, then pay from the payment link", async ({ page }) => {
    await page.goto(liveLink);
    await page.getByRole("textbox").fill("Ravi");
    await page.getByRole("button", { name: "Submit" }).click();
    const step = page.getByRole("dialog", { name: "Payment" });
    const later = await step
      .getByRole("link", { name: "Pay later from this link" })
      .getAttribute("href");
    expect(later).toMatch(/\/payment\?response=[0-9a-f-]{36}$/);
    await step.getByRole("button", { name: "finish without paying" }).click();
    await expect(page.getByRole("heading", { name: "You're in!" })).toBeVisible();

    await page.goto(later!);
    await expect(
      page.getByRole("heading", { name: "Complete your payment" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Pay now" }).click();
    await page.getByRole("button", { name: "Pay ₹499.00" }).click();
    await page.getByRole("button", { name: "Pay with fake Razorpay" }).click();
    await expect(page.getByRole("heading", { name: "Payment received" })).toBeVisible();

    // The public payment endpoints reveal nothing for a made-up response.
    const missing = await page.request.post("/api/payments/start", {
      data: { responseId: crypto.randomUUID() },
    });
    expect(missing.status()).toBe(404);
    const bad = await page.request.post("/api/payments/quote", {
      data: { responseId: "x" },
    });
    expect(bad.status()).toBe(400);
    const verify = await page.request.post("/api/payments/razorpay/verify", {
      data: {
        responseId: crypto.randomUUID(),
        orderId: "order_ABCDEF123",
        paymentId: "pay_ABCDEF123",
        signature: "a".repeat(64),
      },
    });
    expect(verify.status()).toBe(400);
  });
});
