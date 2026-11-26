"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast";
import {
  billingPortalAction,
  changePlanAction,
  setCancelAction,
  startCheckoutAction,
} from "@/app/(dashboard)/settings/billing-actions";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { LocalTime } from "@/components/local-time";
import { cn } from "cn";

export type CheckoutPlan = {
  id: "starter" | "pro" | "business";
  name: string;
  usd: { monthly: number; annual: number };
  inr: { monthly: number; annual: number };
};

export type CurrentSubscription = {
  provider: "stripe" | "razorpay";
  planId: string;
  interval: "month" | "year";
  status: "pending" | "active" | "past_due";
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/**
 * Checkout for a plan (Settings → Plan): Stripe in US dollars or Razorpay
 * in rupees, monthly or yearly. With a subscription: its state, changing
 * plan, cancelling at the period's end, and Stripe's billing portal. The
 * plan itself changes when the provider confirms the payment.
 */
export function PlanCheckout({
  plans,
  providers,
  current,
  currentPlanId,
  initialPlan,
}: {
  plans: CheckoutPlan[];
  providers: ("stripe" | "razorpay")[];
  current: CurrentSubscription | null;
  currentPlanId: string;
  initialPlan?: string;
}) {
  const router = useRouter();
  const [interval, setInterval] = useState<"month" | "year">(current?.interval ?? "year");
  const [planId, setPlanId] = useState<CheckoutPlan["id"]>(
    (plans.find((p) => p.id === initialPlan)?.id ??
      plans.find((p) => p.id !== currentPlanId)?.id ??
      plans[0]?.id) as CheckoutPlan["id"],
  );
  const [pending, start] = useTransition();
  const plan = plans.find((p) => p.id === planId);

  function go(
    fn: () => Promise<{ ok: true; url?: string } | { ok: false; message: string }>,
    done?: string,
  ) {
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      if (r.url) {
        window.location.assign(r.url);
        return;
      }
      if (done) toast.success(done);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {current && (
        <div className="border-border flex flex-col gap-2 rounded-sm border-[1.5px] p-3 text-sm">
          <p>
            <b>
              {plans.find((p) => p.id === current.planId)?.name ?? current.planId},{" "}
              {current.interval === "year" ? "yearly" : "monthly"}
            </b>{" "}
            · {current.provider === "stripe" ? "card (Stripe)" : "Razorpay"} ·{" "}
            {current.status === "pending"
              ? "waiting for the payment to be confirmed"
              : current.status === "past_due"
                ? "the last payment didn't go through"
                : current.cancelAtPeriodEnd
                  ? "cancelled"
                  : "active"}
          </p>
          {current.currentPeriodEnd && (
            <p className="text-muted-foreground">
              {current.cancelAtPeriodEnd ? "Moves to Free on " : "Renews on "}
              <LocalTime iso={current.currentPeriodEnd} variant="date" />. Your forms and
              responses stay either way.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {current.provider === "stripe" && current.status !== "pending" && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => go(billingPortalAction)}
              >
                Cards and invoices
              </Button>
            )}
            {current.status !== "pending" &&
              (current.cancelAtPeriodEnd ? (
                current.provider === "stripe" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      go(() => setCancelAction(false), "Your plan carries on.")
                    }
                  >
                    Keep my plan
                  </Button>
                )
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Cancel at the end of the paid period? The workspace then moves to Free; nothing is deleted.",
                      )
                    )
                      go(
                        () => setCancelAction(true),
                        "Cancelled at the end of the period.",
                      );
                  }}
                >
                  Cancel subscription
                </Button>
              ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div
          className="border-ink flex rounded-sm border-[1.5px] p-1"
          role="group"
          aria-label="Billing period"
        >
          {(["year", "month"] as const).map((i) => (
            <button
              key={i}
              type="button"
              aria-pressed={interval === i}
              onClick={() => setInterval(i)}
              className={cn(
                "fc-focus rounded-sm px-3 py-1 text-sm font-semibold",
                interval === i ? "bg-ink text-background" : "hover:underline",
              )}
            >
              {i === "year" ? "Yearly" : "Monthly"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Plan">
          {plans.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={planId === p.id}
              onClick={() => setPlanId(p.id)}
              className={cn(
                "fc-focus rounded-sm border-[1.5px] px-3 py-1.5 text-left text-sm",
                planId === p.id ? "border-ink bg-card shadow-card" : "border-border",
              )}
            >
              <b>{p.name}</b>
              <span className="text-muted-foreground block text-xs">
                ${interval === "year" ? p.usd.annual : p.usd.monthly}/mo or{" "}
                {inr(interval === "year" ? p.inr.annual : p.inr.monthly)}/mo
              </span>
            </button>
          ))}
        </div>
      </div>

      {plan &&
        (current && current.status !== "pending" ? (
          <Button
            className="self-start"
            disabled={
              pending || (plan.id === current.planId && interval === current.interval)
            }
            onClick={() =>
              go(() => changePlanAction({ planId, interval }), `Moving to ${plan.name}.`)
            }
          >
            {pending && <ButtonSpinner />} Change to {plan.name},{" "}
            {interval === "year" ? "yearly" : "monthly"}
          </Button>
        ) : (
          <div className="flex flex-wrap gap-2">
            {providers.includes("stripe") && (
              <Button
                disabled={pending}
                onClick={() =>
                  go(() => startCheckoutAction({ planId, interval, provider: "stripe" }))
                }
              >
                {pending && <ButtonSpinner />} Pay $
                {interval === "year" ? plan.usd.annual * 12 : plan.usd.monthly} by card
              </Button>
            )}
            {providers.includes("razorpay") && (
              <Button
                variant={providers.includes("stripe") ? "outline" : "default"}
                disabled={pending}
                onClick={() =>
                  go(() =>
                    startCheckoutAction({ planId, interval, provider: "razorpay" }),
                  )
                }
              >
                Pay {inr(interval === "year" ? plan.inr.annual * 12 : plan.inr.monthly)}{" "}
                by UPI or card (India)
              </Button>
            )}
          </div>
        ))}
      <p className="text-muted-foreground text-xs">
        {interval === "year" ? "Charged yearly" : "Charged monthly"}, renewing
        automatically until you cancel. Card payments run on Stripe and UPI on Razorpay:
        card details never reach FormCraft.
      </p>
    </div>
  );
}
