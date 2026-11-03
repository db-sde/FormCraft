"use client";

import { useState } from "react";
import type { ThemeV1 } from "@/domains/forms/schema/v1";
import type { Quote } from "@/domains/payments/flow";
import { formatAmount } from "@/domains/payments/config";
import { Stage, StageButton, StageError, stageDescClass, stageTitleClass } from "./stage";

type RazorpayStart = {
  kind: "razorpay";
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  script: string;
};
type StartReply =
  | { kind: "paid" }
  | { kind: "redirect"; url: string }
  | RazorpayStart
  | { error?: { message?: string } };

type RazorpayHandle = {
  open: () => void;
  on: (event: string, fn: (r: { error?: { description?: string } }) => void) => void;
};
type RazorpayCtor = new (options: Record<string, unknown>) => RazorpayHandle;

let scriptLoad: Promise<RazorpayCtor> | null = null;
/** Razorpay's Checkout script, loaded once, only when someone pays. */
function loadRazorpay(src: string): Promise<RazorpayCtor> {
  const existing = (window as { Razorpay?: RazorpayCtor }).Razorpay;
  if (existing) return Promise.resolve(existing);
  scriptLoad ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => {
      const ctor = (window as { Razorpay?: RazorpayCtor }).Razorpay;
      if (ctor) resolve(ctor);
      else reject(new Error("Razorpay didn't load"));
    };
    s.onerror = () => {
      scriptLoad = null;
      reject(new Error("Razorpay didn't load"));
    };
    document.head.appendChild(s);
  });
  return scriptLoad;
}

async function post<T>(url: string, body: unknown): Promise<{ ok: boolean; data: T }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res) return { ok: false, data: {} as T };
  return { ok: res.ok, data: (await res.json().catch(() => ({}))) as T };
}

/**
 * The form's payment step (master spec F-22/F-35), after the answers are
 * saved: what's owed (worked out on the server), a coupon field when the
 * form has coupons, and Pay — Razorpay's Checkout opens over the form
 * (cards, UPI…); Stripe forms go to Stripe's page. Paid shows only once
 * the server has confirmed it with the provider.
 */
export function PaymentStep({
  theme,
  responseId,
  initialQuote,
  payLaterUrl,
  embedded = false,
  onPaid,
  onRedirect,
  onLater,
}: {
  theme: ThemeV1;
  responseId: string;
  initialQuote: Quote;
  payLaterUrl: string | null;
  embedded?: boolean;
  onPaid: () => void;
  onRedirect: (url: string) => void;
  onLater: () => void;
}) {
  const [quote, setQuote] = useState(initialQuote);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"coupon" | "pay" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const money = (m: number) => formatAmount(m, quote.currency);

  async function applyCode() {
    setBusy("coupon");
    setError(null);
    const { ok, data } = await post<{
      quote?: Quote;
      couponError?: string;
      error?: { message?: string };
    }>("/api/payments/quote", { responseId, coupon: code });
    setBusy(null);
    if (!ok || !data.quote) {
      setError(data.error?.message ?? "That code couldn't be checked. Try again.");
      return;
    }
    setQuote(data.quote);
    if (data.couponError) setError(data.couponError);
  }

  async function pay() {
    setBusy("pay");
    setError(null);
    setNote(null);
    const { ok, data } = await post<StartReply>("/api/payments/start", {
      responseId,
      coupon: quote.coupon?.code ?? null,
    });
    if (!ok || !("kind" in data)) {
      setBusy(null);
      setError(
        ("error" in data && data.error?.message) ||
          "The payment couldn't be started. Please try again.",
      );
      return;
    }
    if (data.kind === "paid") return onPaid();
    if (data.kind === "redirect") return onRedirect(data.url);
    try {
      const Razorpay = await loadRazorpay(data.script);
      const checkout = new Razorpay({
        key: data.keyId,
        order_id: data.orderId,
        amount: data.amount,
        currency: data.currency,
        name: data.name,
        description: data.description,
        theme: { color: theme.primaryColor },
        handler: async (r: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          setNote("Confirming your payment…");
          const verified = await post<{ status?: string; error?: { message?: string } }>(
            "/api/payments/razorpay/verify",
            {
              responseId,
              orderId: r.razorpay_order_id,
              paymentId: r.razorpay_payment_id,
              signature: r.razorpay_signature,
            },
          );
          setBusy(null);
          if (verified.data.status === "paid") return onPaid();
          setNote(null);
          if (verified.data.status === "pending") {
            setNote(
              "Razorpay is still confirming the payment. Your answers are saved; you'll see it as paid once it's confirmed.",
            );
            return;
          }
          setError(
            verified.data.error?.message ?? "The payment didn't go through. Try again.",
          );
        },
        modal: {
          ondismiss: () => {
            setBusy(null);
            setNote("The payment wasn't completed. You can try again.");
          },
        },
      });
      checkout.on("payment.failed", (r) => {
        setError(r.error?.description ?? "The payment failed. You can try again.");
      });
      checkout.open();
    } catch {
      setBusy(null);
      setError("Razorpay couldn't be loaded. Check your connection and try again.");
    }
  }

  return (
    <Stage
      theme={theme}
      role="dialog"
      aria-modal="true"
      aria-labelledby="fc-pay-title"
      className={embedded ? "absolute inset-0 z-40 min-h-[480px]" : "fixed inset-0 z-40"}
    >
      <div className="flex flex-col items-start gap-4">
        <h1 id="fc-pay-title" className={stageTitleClass}>
          Payment
        </h1>
        <p className={stageDescClass}>Your answers are saved. {quote.description}</p>
        <dl className="flex w-full max-w-md flex-col gap-1.5 text-[15px]">
          {(quote.lines ?? []).map((line) => (
            <div key={line.itemId} className="flex justify-between gap-4">
              <dt>
                {line.quantity} × {line.label}
              </dt>
              <dd>{money(line.amount)}</dd>
            </div>
          ))}
          {quote.discount > 0 && (
            <>
              <div className="flex justify-between gap-4 text-(--st-muted)">
                <dt>Subtotal</dt>
                <dd>{money(quote.subtotal)}</dd>
              </div>
              <div className="flex justify-between gap-4 text-(--st-muted)">
                <dt>
                  Coupon {quote.coupon?.code} ({quote.coupon?.label})
                </dt>
                <dd>−{money(quote.discount)}</dd>
              </div>
            </>
          )}
          <div className="flex justify-between gap-4 border-t border-(--st-line) pt-1.5 font-bold">
            <dt>To pay</dt>
            <dd>{money(quote.total)}</dd>
          </div>
        </dl>
        {quote.couponsAvailable && (
          <form
            className="flex w-full max-w-md gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim()) void applyCode();
            }}
          >
            <label className="sr-only" htmlFor="fc-coupon">
              Coupon code
            </label>
            <input
              id="fc-coupon"
              value={code}
              maxLength={40}
              placeholder="Coupon code"
              autoComplete="off"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="h-(--st-btn-h) min-w-0 flex-1 rounded-(--st-br) border-[1.5px] border-(--st-line) bg-(--st-field) px-3"
            />
            <button
              type="submit"
              disabled={busy !== null || !code.trim()}
              className="h-(--st-btn-h) rounded-(--st-br) border-[1.5px] border-(--st-line) px-4 font-semibold disabled:opacity-50"
            >
              Apply
            </button>
          </form>
        )}
        {error && <StageError>{error}</StageError>}
        {note && (
          <p role="status" className={stageDescClass}>
            {note}
          </p>
        )}
        <StageButton onClick={() => void pay()} disabled={busy !== null}>
          {busy === "pay" ? "Opening payment…" : `Pay ${money(quote.total)}`}
        </StageButton>
        <p className={stageDescClass}>
          {payLaterUrl ? (
            <>
              Not now?{" "}
              <a className="underline" href={payLaterUrl}>
                Pay later from this link
              </a>{" "}
              — keep it, or{" "}
            </>
          ) : null}
          <button type="button" className="underline" onClick={onLater}>
            {payLaterUrl ? "finish without paying" : "Finish without paying"}
          </button>
          .
        </p>
      </div>
    </Stage>
  );
}
