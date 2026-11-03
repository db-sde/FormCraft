"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { savePaymentConfigAction } from "@/app/(form)/forms/[id]/(sections)/integrations/actions";
import {
  deleteCouponAction,
  saveCouponAction,
} from "@/app/(form)/forms/[id]/(sections)/integrations/coupon-actions";
import {
  CURRENCIES,
  formatAmount,
  minorUnits,
  type PaymentConfig,
  type PaymentProvider,
} from "@/domains/payments/config";
import type { Coupon } from "@/domains/payments/coupons";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/lib/toast";

type Source = "fixed" | "variable" | "order";

function CouponRow({
  formId,
  coupon,
  currency,
  onChange,
}: {
  formId: string;
  coupon: Coupon;
  currency: string;
  onChange: (next: Coupon | null) => void;
}) {
  const [pending, start] = useTransition();
  const off =
    coupon.kind === "percent"
      ? `${coupon.percentOff}% off`
      : `${formatAmount(coupon.amountOff ?? 0, currency)} off`;
  const [now] = useState(() => Date.now());
  const expired = coupon.expiresAt && Date.parse(coupon.expiresAt) <= now;
  return (
    <li className="bg-background flex flex-wrap items-center gap-3 rounded-sm px-3 py-2 text-sm">
      <code className="font-mono font-bold">{coupon.code}</code>
      <span>{off}</span>
      <span className="text-muted-foreground">
        {coupon.uses} used{coupon.maxUses ? ` of ${coupon.maxUses}` : ""}
        {coupon.expiresAt
          ? ` · ${expired ? "expired" : "until"} ${new Date(coupon.expiresAt).toLocaleDateString()}`
          : ""}
      </span>
      <label className="ml-auto flex items-center gap-1.5">
        <Switch
          checked={coupon.active}
          aria-label={`${coupon.code} on`}
          disabled={pending}
          onCheckedChange={(active) =>
            start(async () => {
              const r = await saveCouponAction(formId, coupon.id, {
                code: coupon.code,
                kind: coupon.kind,
                value:
                  coupon.kind === "percent"
                    ? (coupon.percentOff ?? 1)
                    : (coupon.amountOff ?? 0) / minorUnits(currency),
                expiresAt: coupon.expiresAt
                  ? new Date(coupon.expiresAt).toISOString()
                  : null,
                maxUses: coupon.maxUses,
                active,
              });
              if (r.ok) onChange({ ...coupon, active });
              else toast.error(r.message);
            })
          }
        />
        On
      </label>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Delete ${coupon.code}`}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await deleteCouponAction(formId, coupon.id);
            if (r.ok) onChange(null);
            else toast.error(r.message);
          })
        }
      >
        <Trash2 />
      </Button>
    </li>
  );
}

/** Coupons (F-22): one per payment, checked on the server, counted when
 * paid. */
function Coupons({
  formId,
  currency,
  initial,
}: {
  formId: string;
  currency: string;
  initial: Coupon[];
}) {
  const [coupons, setCoupons] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<"percent" | "amount">("percent");
  const [value, setValue] = useState("");
  const [expires, setExpires] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold">Coupons</span>
      {coupons.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {coupons.map((c) => (
            <CouponRow
              key={c.id}
              formId={formId}
              coupon={c}
              currency={currency}
              onChange={(next) =>
                setCoupons((all) =>
                  next
                    ? all.map((x) => (x.id === c.id ? next : x))
                    : all.filter((x) => x.id !== c.id),
                )
              }
            />
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-xs">
          No coupons. With one, respondents see a field for a code before paying.
        </p>
      )}
      {adding ? (
        <form
          className="bg-background grid gap-3 rounded-sm p-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const input = {
                code,
                kind,
                value: Number(value),
                expiresAt: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
                maxUses: maxUses ? Number(maxUses) : null,
                active: true,
              };
              const r = await saveCouponAction(formId, null, input);
              if (!r.ok) {
                toast.error(r.message);
                return;
              }
              const upper = code.trim().toUpperCase();
              setCoupons((all) => [
                ...all,
                {
                  id: r.id ?? upper,
                  code: upper,
                  kind,
                  percentOff: kind === "percent" ? input.value : null,
                  amountOff:
                    kind === "amount"
                      ? Math.round(input.value * minorUnits(currency))
                      : null,
                  expiresAt: input.expiresAt,
                  maxUses: input.maxUses,
                  uses: 0,
                  active: true,
                },
              ]);
              setCode("");
              setValue("");
              setExpires("");
              setMaxUses("");
              setAdding(false);
              toast.success("Coupon added.");
            });
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="coupon-code">Code</Label>
            <Input
              id="coupon-code"
              required
              maxLength={40}
              placeholder="EARLYBIRD"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </div>
          <div className="grid grid-cols-[1fr_120px] gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="coupon-value">
                {kind === "percent"
                  ? "Percent off"
                  : `Amount off (${currency.toUpperCase()})`}
              </Label>
              <Input
                id="coupon-value"
                type="number"
                required
                min={kind === "percent" ? 1 : 0.01}
                max={kind === "percent" ? 100 : undefined}
                step={kind === "percent" ? 1 : 0.01}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="coupon-kind">Type</Label>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as "percent" | "amount")}
              >
                <SelectTrigger
                  id="coupon-kind"
                  className="w-full"
                  aria-label="Coupon type"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">Percent</SelectItem>
                  <SelectItem value="amount">Amount</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="coupon-expires">Expires (optional)</Label>
            <Input
              id="coupon-expires"
              type="date"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="coupon-max">Usage limit (optional)</Label>
            <Input
              id="coupon-max"
              type="number"
              min={1}
              step={1}
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
            />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending && <ButtonSpinner />}
              Add coupon
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() => setAdding(true)}
        >
          <Plus /> Add a coupon
        </Button>
      )}
    </div>
  );
}

/** Payment on submit (P2.17, F-22/F-35): after their answers are saved,
 * respondents pay in the form — with Razorpay (INR: cards, UPI…) or on
 * Stripe — a fixed price, a calculated total or their product order. */
export function PaymentPanel({
  formId,
  initial,
  numberVariables,
  allowed,
  stripeConnected,
  razorpayConnected,
  orderCurrency,
  coupons,
}: {
  formId: string;
  initial: PaymentConfig | null;
  numberVariables: { id: string; name: string }[];
  allowed: boolean;
  stripeConnected: boolean;
  razorpayConnected: boolean;
  /** The product blocks' currency, when the form has any. */
  orderCurrency: string | null;
  coupons: Coupon[];
}) {
  const providers: PaymentProvider[] = [
    ...(razorpayConnected ? (["razorpay"] as const) : []),
    ...(stripeConnected ? (["stripe"] as const) : []),
  ];
  const [on, setOn] = useState(!!initial);
  const [provider, setProvider] = useState<PaymentProvider>(
    initial?.provider ?? providers[0] ?? "stripe",
  );
  const [source, setSource] = useState<Source>(
    initial?.fromOrder ? "order" : initial?.amountVariableId ? "variable" : "fixed",
  );
  const [amount, setAmount] = useState(initial?.amount ? String(initial.amount) : "");
  const [variableId, setVariableId] = useState(
    initial?.amountVariableId ?? numberVariables[0]?.id ?? "",
  );
  const [currency, setCurrency] = useState<PaymentConfig["currency"]>(
    initial?.currency ?? "usd",
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [pending, start] = useTransition();

  if (!allowed && !initial) {
    return (
      <p className="text-muted-foreground text-sm">
        Payments are part of the Business plan.
      </p>
    );
  }
  if (providers.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Connect Razorpay or Stripe in Settings → Connections to take payments in this
        form.
      </p>
    );
  }
  // Razorpay is INR only; an order is charged in its own currency.
  const effectiveCurrency: PaymentConfig["currency"] =
    provider === "razorpay"
      ? "inr"
      : source === "order" && orderCurrency
        ? (orderCurrency.toLowerCase() as PaymentConfig["currency"])
        : currency;
  const orderMismatch =
    source === "order" &&
    orderCurrency !== null &&
    orderCurrency.toLowerCase() !== effectiveCurrency;

  return (
    <div className="flex flex-col gap-5">
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const config = on
              ? {
                  provider,
                  amount: source === "fixed" ? Number(amount) : null,
                  amountVariableId: source === "variable" ? variableId : null,
                  fromOrder: source === "order",
                  currency: effectiveCurrency,
                  description,
                }
              : null;
            const result = await savePaymentConfigAction(formId, config);
            if (result.ok) toast.success(on ? "Payment saved." : "Payment turned off.");
            else toast.error(result.message);
          });
        }}
      >
        <label className="bg-background flex items-center justify-between gap-3 rounded-sm px-3 py-2.5 text-sm font-semibold">
          Take a payment when people submit
          <input
            type="checkbox"
            checked={on}
            onChange={(e) => setOn(e.target.checked)}
            className="size-4"
          />
        </label>
        {on && (
          <>
            {providers.length > 1 && (
              <div className="grid gap-1.5">
                <Label htmlFor="pay-provider">Paid with</Label>
                <Select
                  value={provider}
                  onValueChange={(v) => setProvider(v as PaymentProvider)}
                >
                  <SelectTrigger id="pay-provider" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="razorpay">
                      Razorpay (INR: cards, UPI and more)
                    </SelectItem>
                    <SelectItem value="stripe">Stripe</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex flex-wrap gap-3 text-[13px]">
              {(["fixed", "variable", "order"] as const).map((s) => (
                <label key={s} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={source === s}
                    onChange={() => setSource(s)}
                    disabled={
                      (s === "variable" && !numberVariables.length) ||
                      (s === "order" && !orderCurrency)
                    }
                  />
                  {s === "fixed"
                    ? "A fixed price"
                    : s === "variable"
                      ? "A calculated total"
                      : "The order total (product blocks)"}
                </label>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
              {source === "fixed" ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="pay-amount">Amount</Label>
                  <Input
                    id="pay-amount"
                    type="number"
                    min={provider === "razorpay" ? "1" : "0.5"}
                    step="0.01"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
              ) : source === "variable" ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="pay-variable">Amount from</Label>
                  <Select value={variableId} onValueChange={setVariableId}>
                    <SelectTrigger id="pay-variable" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {numberVariables.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <p className="text-muted-foreground self-end text-sm">
                  Whatever the respondent orders, priced on the server.
                </p>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="pay-currency">Currency</Label>
                <Select
                  value={effectiveCurrency}
                  disabled={provider === "razorpay" || source === "order"}
                  onValueChange={(v) => setCurrency(v as PaymentConfig["currency"])}
                >
                  <SelectTrigger id="pay-currency" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c.toUpperCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {orderMismatch && (
              <p role="alert" className="text-destructive text-sm">
                The products are priced in {orderCurrency?.toUpperCase()}, but Razorpay
                takes INR. Price the products in INR or use Stripe.
              </p>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="pay-description">What they&apos;re paying for</Label>
              <Input
                id="pay-description"
                required
                maxLength={200}
                value={description}
                placeholder="Workshop ticket"
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <p className="text-muted-foreground text-xs">
              Answers are saved first; a response shows as paid only when{" "}
              {provider === "razorpay" ? "Razorpay" : "Stripe"} confirms it. Unpaid
              responses are kept, and respondents can pay later from their payment link.
            </p>
          </>
        )}
        <Button type="submit" className="self-start" disabled={pending || orderMismatch}>
          {pending && <ButtonSpinner />}
          Save
        </Button>
      </form>
      {initial && (
        <Coupons formId={formId} currency={initial.currency} initial={coupons} />
      )}
    </div>
  );
}
