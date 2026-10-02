"use client";

import { useState, useTransition } from "react";
import { savePaymentConfigAction } from "@/app/(form)/forms/[id]/(sections)/integrations/actions";
import type { PaymentConfig } from "@/domains/payments/stripe";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/lib/toast";

const CURRENCIES = [
  "usd",
  "eur",
  "gbp",
  "inr",
  "cad",
  "aud",
  "jpy",
  "sgd",
  "chf",
] as const;

/** Payment on submit (P2.17): after their answers are saved, respondents
 * pay on Stripe — a fixed price or one the form calculates. */
export function PaymentPanel({
  formId,
  initial,
  numberVariables,
  allowed,
  stripeConnected,
}: {
  formId: string;
  initial: PaymentConfig | null;
  numberVariables: { id: string; name: string }[];
  allowed: boolean;
  stripeConnected: boolean;
}) {
  const [on, setOn] = useState(!!initial);
  const [source, setSource] = useState<"fixed" | "variable">(
    initial?.amountVariableId ? "variable" : "fixed",
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
  if (!stripeConnected) {
    return (
      <p className="text-muted-foreground text-sm">
        Connect Stripe in Settings → Connections to take payments in this form.
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const config: PaymentConfig | null = on
            ? {
                amount: source === "fixed" ? Number(amount) : null,
                amountVariableId: source === "variable" ? variableId : null,
                currency,
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
          <div className="flex gap-2 text-[13px]">
            {(["fixed", "variable"] as const).map((s) => (
              <label key={s} className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={source === s}
                  onChange={() => setSource(s)}
                  disabled={s === "variable" && !numberVariables.length}
                />
                {s === "fixed" ? "A fixed price" : "A calculated total"}
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
                  min="0.5"
                  step="0.01"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            ) : (
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
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="pay-currency">Currency</Label>
              <Select
                value={currency}
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
            Answers are saved first; a response shows as paid only when Stripe confirms
            it.
          </p>
        </>
      )}
      <Button type="submit" className="self-start" disabled={pending}>
        {pending && <ButtonSpinner />}
        Save
      </Button>
    </form>
  );
}
