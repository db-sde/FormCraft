// @vitest-environment node
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseFormSchema } from "@/domains/forms/schema";
import {
  amountToCharge,
  isStripeSecretKey,
  PaymentConfig,
  verifyStripeSignature,
} from "@/domains/payments/stripe";
import {
  contactProperties,
  isHubspotToken,
  mappingProblems,
} from "@/domains/integrations/hubspot";

const sign = (body: string, secret: string, t: number) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

describe("Stripe (P2.17)", () => {
  it("accepts only correctly signed, fresh webhooks", () => {
    const body = '{"type":"checkout.session.completed"}';
    const now = Date.now();
    const t = Math.floor(now / 1000);
    expect(
      verifyStripeSignature(body, sign(body, "whsec_abc", t), "whsec_abc", now),
    ).toBe(true);
    expect(
      verifyStripeSignature(body, sign(body, "whsec_other", t), "whsec_abc", now),
    ).toBe(false);
    expect(
      verifyStripeSignature(`${body} `, sign(body, "whsec_abc", t), "whsec_abc", now),
    ).toBe(false);
    expect(
      verifyStripeSignature(body, sign(body, "whsec_abc", t - 600), "whsec_abc", now),
    ).toBe(false);
    expect(verifyStripeSignature(body, null, "whsec_abc", now)).toBe(false);
  });

  it("works out the amount on the server, fixed or calculated", () => {
    const fixed = PaymentConfig.parse({
      amount: 15,
      amountVariableId: null,
      currency: "usd",
      description: "Ticket",
    });
    expect(amountToCharge(fixed, {})).toEqual({ ok: true, minor: 1500 });
    const calc = PaymentConfig.parse({
      amount: null,
      amountVariableId: "v_total",
      currency: "eur",
      description: "Order",
    });
    expect(amountToCharge(calc, { v_total: 49.99 })).toEqual({ ok: true, minor: 4999 });
    expect(amountToCharge(calc, { v_total: 0 }).ok).toBe(false);
    expect(amountToCharge(calc, { v_total: "49" }).ok).toBe(false);
    const yen = PaymentConfig.parse({
      amount: 1200,
      amountVariableId: null,
      currency: "jpy",
      description: "x",
    });
    expect(amountToCharge(yen, {})).toEqual({ ok: true, minor: 1200 });
    expect(
      PaymentConfig.safeParse({
        amount: 5,
        amountVariableId: "v",
        currency: "usd",
        description: "x",
      }).success,
    ).toBe(false);
  });

  it("recognise Stripe keys", () => {
    expect(isStripeSecretKey("sk_test_51ABCdefGHIjkl")).toBe(true);
    expect(isStripeSecretKey("pk_test_51ABCdefGHIjkl")).toBe(false);
  });
});

describe("HubSpot (P2.15)", () => {
  const schema = parseFormSchema({
    schemaVersion: 1,
    meta: { title: "Lead" },
    theme: {},
    endings: [{ id: "end", title: "Thanks", isDefault: true }],
    questions: [
      {
        id: "contact",
        type: "contact_info",
        order: 0,
        label: "You",
        settings: { fields: ["name", "email", "company"], requiredFields: ["email"] },
      },
      {
        id: "size",
        type: "single_select",
        order: 1,
        label: "Size",
        settings: { options: [{ id: "o_big", label: "50+" }] },
      },
      {
        id: "cv",
        type: "file_upload",
        order: 2,
        label: "CV",
        settings: { acceptedMimeTypes: ["application/pdf"], maxSizeMb: 5 },
      },
    ],
    logic: [],
  });

  it("maps answers to properties by choice, never sending files", () => {
    expect(
      contactProperties(
        schema,
        {
          contact: { name: "Ada", email: "ada@x.co", company: "Acme" },
          size: "o_big",
          cv: "u1",
        },
        {
          email: "contact.email",
          firstname: "contact.name",
          company_size: "size",
          resume: "cv",
        },
      ),
    ).toEqual({ email: "ada@x.co", firstname: "Ada", company_size: "50+" });
  });

  it("insists on email and real questions", () => {
    expect(mappingProblems(schema, { firstname: "contact.name" })[0]).toContain("Email");
    expect(mappingProblems(schema, { email: "contact.email", x: "gone" })).toContain(
      "The question mapped to x no longer exists.",
    );
    expect(mappingProblems(schema, { email: "contact.email" })).toEqual([]);
    expect(isHubspotToken("pat-na1-11111111-2222-3333-4444-555555555555")).toBe(true);
    expect(isHubspotToken("secret")).toBe(false);
  });
});
