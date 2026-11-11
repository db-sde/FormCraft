"use client";

import { useState } from "react";
import { nanoid } from "nanoid";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { ProductItemV1, QuestionV1 } from "@/domains/forms/schema/v1";
import {
  DEFAULT_MAX_QUANTITY,
  formatMoney,
  isKnownCurrency,
  moneyInputValue,
  parseMoney,
} from "@/domains/forms/products";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import { ImageUploadField } from "./image-upload-field";
import { PANEL_INPUT, PanelField, PanelNote, SectionHead, SwitchRow } from "./panel-ui";
import { useOrdersCharged } from "@/components/order-payment";

type Change = (next: QuestionV1) => void;

// --- signature (F-10) -------------------------------------------------------

export function SignatureSettingsPanel({
  question,
  onChange,
}: {
  question: Extract<QuestionV1, { type: "signature" }>;
  onChange: Change;
}) {
  const set = (patch: Record<string, unknown>) =>
    onChange({ ...question, settings: { ...question.settings, ...patch } } as QuestionV1);
  return (
    <>
      <SectionHead>Signature</SectionHead>
      <PanelField
        label="Text above the pad"
        hint="What the respondent agrees to by signing."
      >
        <Textarea
          className="min-h-[64px] text-[13.5px]"
          maxLength={500}
          value={question.settings.consentText ?? ""}
          placeholder="By signing, I agree to the terms above."
          onChange={(e) => set({ consentText: e.target.value || undefined })}
        />
      </PanelField>
      <SwitchRow
        label="Allow typing a name"
        hint="For people who can't draw: keyboard and screen-reader users, or no touch screen."
        checked={question.settings.allowTyped !== false}
        onCheckedChange={(on) => set({ allowTyped: on ? undefined : false })}
      />
      <PanelNote>
        A simple electronic signature: the image and when it was signed are saved with the
        response. It isn&apos;t a certified or identity-verified signature.
      </PanelNote>
    </>
  );
}

// --- products (F-04) --------------------------------------------------------

const COMMON_CURRENCIES = ["USD", "EUR", "GBP", "INR", "CAD", "AUD", "JPY", "SGD"];

/** A price field that keeps what the creator is typing until it parses. */
function PriceInput({
  item,
  currency,
  onChange,
}: {
  item: ProductItemV1;
  currency: string;
  onChange: (price: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? moneyInputValue(item.price, currency);
  const parsed = parseMoney(shown, currency);
  return (
    <Input
      className={cn(PANEL_INPUT, parsed === null && "border-destructive")}
      inputMode="decimal"
      aria-label={`Price of ${item.label || "this item"} in ${currency}`}
      aria-invalid={parsed === null}
      value={shown}
      onChange={(e) => {
        setDraft(e.target.value);
        const next = parseMoney(e.target.value, currency);
        if (next !== null) onChange(next);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

export function ProductsSettingsPanel({
  question,
  onChange,
  workspaceId,
  formId,
}: {
  question: Extract<QuestionV1, { type: "products" }>;
  onChange: Change;
  workspaceId: string;
  formId: string;
}) {
  const { currency, items } = question.settings;
  const [currencyDraft, setCurrencyDraft] = useState(currency);
  const charged = useOrdersCharged();
  const setItems = (next: ProductItemV1[]) =>
    onChange({ ...question, settings: { ...question.settings, items: next } });
  const patch = (id: string, change: Partial<ProductItemV1>) =>
    setItems(items.map((i) => (i.id === id ? { ...i, ...change } : i)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    setItems(next);
  };

  return (
    <>
      <SectionHead>Products</SectionHead>
      {!charged && (
        <p className="rounded-sm bg-[var(--alert-warning-bg)] px-3 py-2.5 text-[13px] text-[var(--alert-warning-fg)]">
          Orders are recorded but not charged: this form doesn&apos;t take a payment yet.
          Respondents are told they won&apos;t be charged. To charge the order total, set
          up Payment in Integrations.
        </p>
      )}
      <PanelField
        label="Currency"
        hint={
          isKnownCurrency(currencyDraft)
            ? "One currency for the whole form. Prices are saved exactly, in its smallest unit."
            : "Use a 3-letter currency code, like USD or INR."
        }
      >
        <Input
          className={cn(PANEL_INPUT, "uppercase")}
          list={`${question.id}-currencies`}
          maxLength={3}
          value={currencyDraft}
          onChange={(e) => {
            const code = e.target.value.toUpperCase();
            setCurrencyDraft(code);
            if (isKnownCurrency(code)) {
              onChange({
                ...question,
                settings: { ...question.settings, currency: code },
              });
            }
          }}
        />
        <datalist id={`${question.id}-currencies`}>
          {COMMON_CURRENCIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </PanelField>

      <div className="col-span-full flex flex-col gap-3">
        {items.map((item, index) => (
          <div
            key={item.id}
            className="border-border flex flex-col gap-2 border-t pt-3"
            data-testid="product-item"
          >
            <div className="flex items-center gap-1.5">
              <Input
                className={cn(PANEL_INPUT, "flex-1 font-semibold")}
                aria-label={`Item ${index + 1} name`}
                maxLength={200}
                value={item.label}
                placeholder="Item name"
                onChange={(e) => patch(item.id, { label: e.target.value })}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Move ${item.label || "item"} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Move ${item.label || "item"} down`}
                disabled={index === items.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown className="size-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Remove ${item.label || "item"}`}
                disabled={items.length === 1}
                onClick={() => setItems(items.filter((i) => i.id !== item.id))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-[12px] font-semibold">
                Price
                <PriceInput
                  item={item}
                  currency={currency}
                  onChange={(price) => patch(item.id, { price })}
                />
              </label>
              <label className="flex flex-col gap-1 text-[12px] font-semibold">
                Most per order
                <Input
                  className={PANEL_INPUT}
                  type="number"
                  min={1}
                  max={999}
                  value={item.maxQuantity ?? DEFAULT_MAX_QUANTITY}
                  onChange={(e) => {
                    const n = Math.floor(Number(e.target.value));
                    if (n >= 1 && n <= 999) patch(item.id, { maxQuantity: n });
                  }}
                />
              </label>
            </div>
            <Input
              className={PANEL_INPUT}
              aria-label={`Item ${index + 1} description`}
              maxLength={500}
              value={item.description ?? ""}
              placeholder="Description (optional)"
              onChange={(e) =>
                patch(item.id, { description: e.target.value || undefined })
              }
            />
            <ImageUploadField
              label="Picture"
              noun="a picture"
              workspaceId={workspaceId}
              formId={formId}
              value={item.imageUrl}
              onChange={(imageUrl) =>
                patch(item.id, {
                  imageUrl,
                  imageAlt: imageUrl ? item.imageAlt : undefined,
                })
              }
            />
            {item.imageUrl && (
              <Input
                className={PANEL_INPUT}
                aria-label={`Picture description for ${item.label}`}
                placeholder="What the picture shows, for screen readers"
                maxLength={300}
                value={item.imageAlt ?? ""}
                onChange={(e) =>
                  patch(item.id, { imageAlt: e.target.value || undefined })
                }
              />
            )}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          disabled={items.length >= 50}
          onClick={() =>
            setItems([
              ...items,
              {
                id: `item_${nanoid(10)}`,
                label: `Item ${items.length + 1}`,
                price: 0,
              },
            ])
          }
        >
          <Plus className="size-4" />
          Add item
        </Button>
      </div>
      <PanelNote>
        Respondents pick quantities and see the total; the server works out prices and the
        total again from the published form, e.g. {formatMoney(1250, currency)}.
      </PanelNote>
    </>
  );
}
