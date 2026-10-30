import type { ProductItemV1, QuestionV1 } from "@/domains/forms/schema/v1";

/**
 * Product / order block (master spec F-04) — the pure part, shared by the
 * runtime, the builder and the server.
 *
 * Prices are integers in the currency's minor units (cents, or yen for a
 * currency without them), so totals are plain integer sums: nothing to
 * round. The answer only says how many of each item; the server works
 * out prices and the total from the published form, never from the
 * browser. A form has one currency (product owner, 2026-10-30).
 */

export type ProductsQuestion = Extract<QuestionV1, { type: "products" }>;

export const DEFAULT_MAX_QUANTITY = 10;

/** Upper bound on one order's total, in minor units: well inside what a
 * bigint column and JavaScript integers hold exactly. */
export const MAX_ORDER_TOTAL = 1_000_000_000_000;

export function maxQuantity(item: ProductItemV1): number {
  return item.maxQuantity ?? DEFAULT_MAX_QUANTITY;
}

/** Digits after the decimal point for a currency (2 for USD, 0 for JPY,
 * 3 for KWD). */
export function currencyDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** ISO 4217 codes this runtime knows; any well-formed code when it can't
 * list them (older runtimes). */
const KNOWN_CURRENCIES: ReadonlySet<string> | null =
  typeof Intl.supportedValuesOf === "function"
    ? new Set(Intl.supportedValuesOf("currency"))
    : null;

export function isKnownCurrency(currency: string): boolean {
  if (!/^[A-Z]{3}$/.test(currency)) return false;
  return KNOWN_CURRENCIES ? KNOWN_CURRENCIES.has(currency) : true;
}

/** "$12.50" from 1250 USD minor units. */
export function formatMoney(minor: number, currency: string, locale = "en"): string {
  const digits = currencyDigits(currency);
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
      minor / 10 ** digits,
    );
  } catch {
    return `${(minor / 10 ** digits).toFixed(digits)} ${currency}`;
  }
}

/** Minor units from what a creator typed ("12.5" → 1250 for USD), parsed
 * as text so there's no float error. Null when it isn't a price. */
export function parseMoney(text: string, currency: string): number | null {
  const digits = currencyDigits(currency);
  const m = /^\s*(\d{1,9})(?:[.,](\d*))?\s*$/.exec(text);
  if (!m) return null;
  const fraction = m[2] ?? "";
  if (fraction.length > digits) return null;
  return Number(m[1]) * 10 ** digits + Number(fraction.padEnd(digits, "0") || 0);
}

/** "12.50" for an input field (no currency symbol). */
export function moneyInputValue(minor: number, currency: string): string {
  const digits = currencyDigits(currency);
  if (digits === 0) return String(minor);
  const whole = Math.floor(minor / 10 ** digits);
  const fraction = String(minor % 10 ** digits).padStart(digits, "0");
  return `${whole}.${fraction}`;
}

/** The quantities in an answer, as given; nothing checked. */
export function quantities(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Why an answer can't be an order for this question, or null. Zero
 * quantities aren't allowed in the stored answer (an item not ordered is
 * left out). */
export function orderProblem(question: ProductsQuestion, value: unknown): string | null {
  const entries = Object.entries(quantities(value));
  if (entries.length === 0) return "Choose at least one item.";
  for (const [itemId, qty] of entries) {
    const item = question.settings.items.find((i) => i.id === itemId);
    if (!item) return "One of those items isn't available any more.";
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1) {
      return `Choose how many of “${item.label}”.`;
    }
    if (qty > maxQuantity(item)) {
      return `You can order up to ${maxQuantity(item)} of “${item.label}”.`;
    }
  }
  if (orderFromAnswer(question, value).total > MAX_ORDER_TOTAL) {
    return "That order is too large.";
  }
  return null;
}

export type OrderLine = {
  itemId: string;
  label: string;
  unitAmount: number;
  quantity: number;
  amount: number;
};

/** The order an answer places, in the form's item order. Items or
 * quantities that don't fit are skipped (orderProblem refuses them
 * before anything is saved). */
export function orderFromAnswer(
  question: ProductsQuestion,
  value: unknown,
): { currency: string; lines: OrderLine[]; total: number } {
  const qty = quantities(value);
  const lines: OrderLine[] = [];
  for (const item of question.settings.items) {
    const q = qty[item.id];
    if (typeof q !== "number" || !Number.isInteger(q) || q < 1 || q > maxQuantity(item))
      continue;
    lines.push({
      itemId: item.id,
      label: item.label,
      unitAmount: item.price,
      quantity: q,
      amount: item.price * q,
    });
  }
  return {
    currency: question.settings.currency,
    lines,
    total: lines.reduce((sum, line) => sum + line.amount, 0),
  };
}

/** One order for a whole response: every product question on the path,
 * combined. Null when nothing was ordered. */
export function orderForResponse(
  questions: QuestionV1[],
  answers: Record<string, unknown>,
): { currency: string; lines: OrderLine[]; total: number } | null {
  const orders = questions
    .filter((q): q is ProductsQuestion => q.type === "products")
    .map((q) => orderFromAnswer(q, answers[q.id]))
    .filter((o) => o.lines.length > 0);
  if (orders.length === 0) return null;
  return {
    currency: orders[0].currency,
    lines: orders.flatMap((o) => o.lines),
    total: orders.reduce((sum, o) => sum + o.total, 0),
  };
}

/** "2 × T-shirt, 1 × Mug — total $45.00" */
export function describeOrder(question: ProductsQuestion, value: unknown): string {
  const order = orderFromAnswer(question, value);
  if (order.lines.length === 0) return "";
  const items = order.lines.map((l) => `${l.quantity} × ${l.label}`).join(", ");
  return `${items} — total ${formatMoney(order.total, order.currency)}`;
}

/** The currencies a form's product blocks use; more than one is refused
 * when the form is saved. */
export function formCurrencies(questions: QuestionV1[]): string[] {
  return [
    ...new Set(
      questions
        .filter((q): q is ProductsQuestion => q.type === "products")
        .map((q) => q.settings.currency),
    ),
  ];
}
