import { createServer, type Server } from "node:http";
import { createHmac } from "node:crypto";
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
 * Stripe payments (P2.17) end to end against a fake Stripe (the app's
 * STRIPE_API_BASE points here, see playwright.config.ts): submit → the
 * server starts Checkout → cancel → "didn't go through" + retry → pay →
 * "Payment received", with the status coming from Stripe, not the
 * browser. Then the webhook: unsigned events are refused, and a paid
 * payment never goes back.
 */
const PORT = 4600;
const WEBHOOK_SECRET = "whsec_e2etestsecret";
type FakeSession = {
  id: string;
  success: string;
  cancel: string;
  paid: boolean;
  amount: string;
  metadata: Record<string, string>;
};
const sessions = new Map<string, FakeSession>();
let server: Server;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
      if (req.method === "POST" && url.pathname === "/v1/checkout/sessions") {
        const form = new URLSearchParams(raw);
        const id = `cs_test_e2e${sessions.size + 1}x${Date.now()}`;
        sessions.set(id, {
          id,
          success: form.get("success_url")!.replace("{CHECKOUT_SESSION_ID}", id),
          cancel: form.get("cancel_url")!,
          paid: false,
          amount: form.get("line_items[0][price_data][unit_amount]")!,
          metadata: { response_id: form.get("metadata[response_id]")! },
        });
        res.setHeader("content-type", "application/json");
        return res.end(
          JSON.stringify({
            id,
            url: `http://127.0.0.1:${PORT}/pay/${id}`,
            livemode: false,
          }),
        );
      }
      const pay = /^\/pay\/(cs_[\w]+)$/.exec(url.pathname);
      if (pay && sessions.has(pay[1])) {
        const s = sessions.get(pay[1])!;
        res.setHeader("content-type", "text/html");
        return res.end(
          `<h1>Fake Stripe checkout</h1><p>${s.amount}</p><a href="/pay/${s.id}/ok">Pay</a> <a href="${s.cancel}">Cancel</a>`,
        );
      }
      const ok = /^\/pay\/(cs_[\w]+)\/ok$/.exec(url.pathname);
      if (ok && sessions.has(ok[1])) {
        const s = sessions.get(ok[1])!;
        s.paid = true;
        res.writeHead(302, { location: s.success });
        return res.end();
      }
      const get = /^\/v1\/checkout\/sessions\/(cs_[\w]+)$/.exec(url.pathname);
      if (get && sessions.has(get[1])) {
        const s = sessions.get(get[1])!;
        res.setHeader("content-type", "application/json");
        return res.end(
          JSON.stringify({
            id: s.id,
            payment_status: s.paid ? "paid" : "unpaid",
            status: s.paid ? "complete" : "open",
            metadata: s.metadata,
          }),
        );
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Workshop" },
  theme: {
    primaryColor: "#1f1f1f",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "See you there", isDefault: true }],
  questions: [
    {
      id: "q1",
      type: "short_text",
      order: 0,
      label: "Your name?",
      required: true,
      settings: {},
    },
  ],
  logic: [],
};

test("respondents pay on Stripe, and only Stripe's word marks it paid", async ({
  page,
  request,
}) => {
  const user = await createConfirmedUser("e2e-pay");
  try {
    const { formId, liveLink } = await createPublishedForm(user, schema);
    const admin = adminClient();
    const { data: form } = await admin
      .from("forms")
      .select("workspace_id")
      .eq("id", formId)
      .single();
    const workspaceId = form!.workspace_id;
    await admin.from("workspaces").update({ plan_id: "business" }).eq("id", workspaceId);
    await admin
      .from("forms")
      .update({
        payment_config: {
          amount: 15,
          amountVariableId: null,
          currency: "usd",
          description: "Workshop ticket",
        },
      })
      .eq("id", formId);
    await saveCredential(
      admin,
      workspaceId,
      "stripe",
      { secretKey: "sk_test_e2efake12345", webhookSecret: WEBHOOK_SECRET },
      "sk_test_…2345",
    );

    await page.goto(liveLink);
    await page.getByRole("textbox").fill("Ada");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(
      page.getByRole("heading", { name: "Fake Stripe checkout" }),
    ).toBeVisible();
    await expect(page.getByText("1500")).toBeVisible();

    // Cancel: answers are kept, the payment isn't, and they can retry.
    await page.getByRole("link", { name: "Cancel" }).click();
    await expect(
      page.getByRole("heading", { name: "The payment didn't go through" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Try the payment again" }).click();
    await expect(
      page.getByRole("heading", { name: "Fake Stripe checkout" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Pay" }).click();
    await expect(page.getByRole("heading", { name: "Payment received" })).toBeVisible();

    const { data: payments } = await admin
      .from("payments")
      .select("status, amount, checkout_session_id")
      .eq("form_id", formId);
    expect(payments).toHaveLength(1);
    expect(payments![0]).toMatchObject({ status: "paid", amount: 1500 });

    // The webhook: unsigned → refused; signed "expired" → paid stays paid.
    const hook = `/api/payments/stripe/${workspaceId}`;
    const event = JSON.stringify({
      type: "checkout.session.expired",
      data: { object: { id: payments![0].checkout_session_id } },
    });
    expect(
      (
        await request.post(hook, {
          data: event,
          headers: { "content-type": "application/json" },
        })
      ).status(),
    ).toBe(400);
    const t = Math.floor(Date.now() / 1000);
    const signature = `t=${t},v1=${createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${event}`).digest("hex")}`;
    const signed = await request.post(hook, {
      data: event,
      headers: { "content-type": "application/json", "stripe-signature": signature },
    });
    expect(signed.status()).toBe(200);
    expect(
      (await admin.from("payments").select("status").eq("form_id", formId).single()).data
        ?.status,
    ).toBe("paid");
  } finally {
    await deleteUser(user.userId);
  }
});
