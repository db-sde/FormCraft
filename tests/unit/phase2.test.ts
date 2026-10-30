import { describe, expect, it } from "vitest";
import type { FormSchemaV1, QuestionV1 } from "@/domains/forms/schema/v1";
import {
  describeOrder,
  formatMoney,
  moneyInputValue,
  orderForResponse,
  orderFromAnswer,
  orderProblem,
  parseMoney,
} from "@/domains/forms/products";
import { validateAnswer } from "@/domains/logic/validate-answer";
import {
  answerCells,
  formatAnswerValue,
  questionColumnLabels,
} from "@/domains/responses/format";
import { analyzeLogic } from "@/domains/forms/schema/analyze";
import { parseFormSchema } from "@/domains/forms/schema/validate";
import { buildTimeline, emailEvent } from "@/domains/responses/timeline";
import { isReviewStatus } from "@/domains/responses/review";
import { createQuestion } from "@/domains/forms/builder";

const products = {
  id: "q_shop",
  type: "products",
  order: 1,
  label: "Order",
  required: true,
  settings: {
    currency: "USD",
    items: [
      { id: "tee", label: "T-shirt", price: 1999, maxQuantity: 3 },
      { id: "mug", label: "Mug", price: 850 },
    ],
  },
} as Extract<QuestionV1, { type: "products" }>;

describe("money (F-04)", () => {
  it("parses prices as text into minor units, with no float error", () => {
    expect(parseMoney("12.5", "USD")).toBe(1250);
    expect(parseMoney("0.1", "USD")).toBe(10);
    expect(parseMoney("19.99", "USD")).toBe(1999);
    expect(parseMoney("1,5", "EUR")).toBe(150);
    expect(parseMoney("500", "JPY")).toBe(500);
    expect(parseMoney("1.5", "JPY")).toBeNull();
    expect(parseMoney("1.234", "KWD")).toBe(1234);
    expect(parseMoney("1.999", "USD")).toBeNull();
    expect(parseMoney("-1", "USD")).toBeNull();
    expect(parseMoney("abc", "USD")).toBeNull();
    expect(moneyInputValue(1205, "USD")).toBe("12.05");
    expect(moneyInputValue(500, "JPY")).toBe("500");
    expect(formatMoney(1250, "USD")).toBe("$12.50");
    expect(formatMoney(500, "JPY")).toBe("¥500");
  });
});

describe("product orders (F-04)", () => {
  it("totals integer prices exactly and ignores what doesn't fit", () => {
    const order = orderFromAnswer(products, { tee: 3, mug: 2 });
    expect(order.total).toBe(3 * 1999 + 2 * 850);
    expect(order.lines.map((l) => l.itemId)).toEqual(["tee", "mug"]);
    // Over the limit, unknown, fractional and zero quantities don't count.
    expect(orderFromAnswer(products, { tee: 4, ghost: 1, mug: 0.5 }).lines).toEqual([]);
  });

  it("refuses orders the server wouldn't accept", () => {
    expect(orderProblem(products, {})).toMatch(/at least one/);
    expect(orderProblem(products, { tee: 4 })).toMatch(/up to 3/);
    expect(orderProblem(products, { ghost: 1 })).toMatch(/isn't available/);
    expect(orderProblem(products, { tee: 0 })).toMatch(/how many/);
    expect(orderProblem(products, { tee: "2" })).toMatch(/how many/);
    expect(orderProblem(products, { tee: 1 })).toBeNull();
    expect(validateAnswer(products, { tee: 1 }).ok).toBe(true);
    expect(validateAnswer(products, undefined).ok).toBe(false);
    expect(validateAnswer({ ...products, required: false }, undefined).ok).toBe(true);
    expect(validateAnswer(products, { tee: 9 }).ok).toBe(false);
  });

  it("combines product blocks on a response into one order", () => {
    const second = {
      ...products,
      id: "q_more",
      settings: {
        ...products.settings,
        items: [{ id: "cap", label: "Cap", price: 1200 }],
      },
    } as typeof products;
    const order = orderForResponse([products, second], {
      q_shop: { mug: 1 },
      q_more: { cap: 2 },
    });
    expect(order).toMatchObject({ currency: "USD", total: 850 + 2400 });
    expect(orderForResponse([products], {})).toBeNull();
  });

  it("formats and exports an order: one column per item plus the total", () => {
    expect(describeOrder(products, { tee: 2 })).toBe("2 × T-shirt — total $39.98");
    expect(formatAnswerValue(products, { tee: 2 })).toBe("2 × T-shirt — total $39.98");
    expect(questionColumnLabels(products)).toEqual([
      "Order (T-shirt)",
      "Order (Mug)",
      "Order (Total USD)",
    ]);
    expect(answerCells(products, products, { mug: 3 })).toEqual(["", "3", "$25.50"]);
  });

  it("allows one currency per form", () => {
    const schema = (currency: string): FormSchemaV1 =>
      parseFormSchema({
        schemaVersion: 1,
        meta: { title: "Shop" },
        theme: {
          primaryColor: "#0f172a",
          backgroundColor: "#ffffff",
          fontFamily: "inter",
          buttonStyle: "rounded",
        },
        endings: [{ id: "e", title: "Thanks", isDefault: true }],
        questions: [
          products,
          {
            ...products,
            id: "q_two",
            order: 2,
            settings: { ...products.settings, currency },
          },
        ],
        logic: [],
      });
    expect(analyzeLogic(schema("USD")).map((i) => i.code)).not.toContain(
      "mixed_currency",
    );
    expect(analyzeLogic(schema("EUR")).map((i) => i.code)).toContain("mixed_currency");
    expect(analyzeLogic(schema("XYZ")).map((i) => i.code)).toContain("unknown_currency");
  });

  it("starts a new product block valid", () => {
    expect(() =>
      parseFormSchema({
        schemaVersion: 1,
        meta: { title: "x" },
        theme: {
          primaryColor: "#0f172a",
          backgroundColor: "#ffffff",
          fontFamily: "inter",
          buttonStyle: "rounded",
        },
        endings: [{ id: "e", title: "Thanks", isDefault: true }],
        questions: [createQuestion("products", 0), createQuestion("signature", 1)],
        logic: [],
      }),
    ).not.toThrow();
  });
});

describe("signature (F-10)", () => {
  const signature = createQuestion("signature", 0) as Extract<
    QuestionV1,
    { type: "signature" }
  >;
  it("needs an upload id when required and shows as signed", () => {
    expect(validateAnswer({ ...signature, required: true }, undefined).ok).toBe(false);
    expect(validateAnswer({ ...signature, required: true }, "upload-id").ok).toBe(true);
    expect(formatAnswerValue(signature, "upload-id")).toBe("Signed");
    expect(formatAnswerValue(signature, undefined)).toBe("");
  });
});

describe("timeline (F-31)", () => {
  const response = {
    startedAt: "2026-10-30T10:00:00.000Z",
    lastActiveAt: "2026-10-30T10:05:00.000Z",
    completedAt: "2026-10-30T10:05:00.000Z",
    status: "completed",
  };

  it("orders entries by time, with a fixed order for ties", () => {
    const entries = buildTimeline({
      response,
      deliveries: [
        {
          id: "d1",
          kind: "slack",
          status: "exhausted",
          attemptCount: 8,
          lastError: "HTTP 500",
          createdAt: "2026-10-30T10:05:00.000Z",
          updatedAt: "2026-10-30T12:00:00.000Z",
        },
      ],
      sheets: [
        {
          id: "s1",
          status: "succeeded",
          attemptCount: 1,
          lastError: null,
          createdAt: "2026-10-30T10:05:00.000Z",
          updatedAt: "2026-10-30T10:05:01.000Z",
        },
      ],
      payment: null,
      events: [
        {
          id: 2,
          kind: "status_changed",
          outcome: "ok",
          detail: { from: "new", to: "done" },
          actor: "Ana",
          createdAt: "2026-10-30T11:00:00.000Z",
        },
        {
          id: 1,
          kind: "email_owner",
          outcome: "ok",
          detail: {},
          actor: null,
          createdAt: "2026-10-30T10:05:00.000Z",
        },
      ],
    });
    expect(entries.map((e) => e.key)).toEqual([
      "started",
      "completed",
      "event-1",
      "webhook-d1",
      "sheets-s1",
      "event-2",
    ]);
    const slack = entries.find((e) => e.key === "webhook-d1")!;
    expect(slack).toMatchObject({
      title: "Slack",
      outcome: "failed",
      replay: { target: "webhook", id: "d1" },
    });
    expect(slack.detail).toBe("HTTP 500 · 8 attempts, gave up");
    expect(entries.find((e) => e.key === "sheets-s1")?.replay).toBeUndefined();
    expect(entries.at(-1)).toMatchObject({
      title: "Status set to Done",
      detail: "Was New",
      actor: "Ana",
    });
  });

  it("never offers a payment for replay", () => {
    const entries = buildTimeline({
      response,
      deliveries: [],
      sheets: [],
      payment: {
        status: "failed",
        amount: 1250,
        currency: "usd",
        createdAt: "2026-10-30T10:05:00.000Z",
        paidAt: null,
      },
      events: [],
    });
    expect(entries.map((e) => e.title)).toContain("Payment of $12.50 started");
    expect(entries.map((e) => e.title)).toContain("Payment failed");
    expect(entries.every((e) => e.replay === undefined)).toBe(true);
  });

  it("logs email outcomes worth showing, not ones that were off", () => {
    expect(emailEvent({ sent: true })).toEqual({ outcome: "ok" });
    expect(emailEvent({ sent: false, reason: "send_failed" })?.outcome).toBe("failed");
    expect(emailEvent({ sent: false, reason: "no_api_key" })?.outcome).toBe("skipped");
    expect(emailEvent({ sent: false, reason: "disabled" })).toBeNull();
    expect(emailEvent({ sent: false, reason: "not_enabled" })).toBeNull();
  });

  it("shows an unfinished response as last saved", () => {
    const entries = buildTimeline({
      response: { ...response, completedAt: null, status: "partial" },
      deliveries: [],
      sheets: [],
      payment: null,
      events: [],
    });
    expect(entries.map((e) => e.title)).toEqual(["Started", "Last saved"]);
  });
});

describe("review statuses (F-03)", () => {
  it("accepts only the three statuses", () => {
    expect(["new", "in_progress", "done"].every(isReviewStatus)).toBe(true);
    expect(isReviewStatus("archived")).toBe(false);
    expect(isReviewStatus(undefined)).toBe(false);
  });
});
