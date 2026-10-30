"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ImageOff, Minus, PenLine, Plus, Type } from "lucide-react";
import type { QuestionV1 } from "@/domains/forms/schema/v1";
import {
  formatMoney,
  maxQuantity,
  orderFromAnswer,
  quantities,
} from "@/domains/forms/products";
import { cn } from "cn";
import { StageError } from "./stage";

// --- signature (F-10) -------------------------------------------------------

/** The pad's drawing size in CSS pixels; drawn at up to 2× for sharp
 * lines and saved as a small PNG on white, like ink on paper. */
const PAD_WIDTH = 560;
const PAD_HEIGHT = 180;
const SAVE_DELAY_MS = 700;
const TYPED_FONT =
  '"Segoe Script", "Brush Script MT", "Snell Roundhand", "Apple Chancery", cursive';

type SaveState = "idle" | "saving" | "saved" | "error";

/** White paper, dark ink, drawn in the pad's own coordinates. */
function paintBlank(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const scale = canvas.width / PAD_WIDTH;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PAD_WIDTH, PAD_HEIGHT);
  ctx.strokeStyle = "#111111";
  ctx.fillStyle = "#111111";
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

export function SignatureInput({
  question,
  value,
  onChange,
  getResponseId,
  idPrefix,
}: {
  question: Extract<QuestionV1, { type: "signature" }>;
  value: unknown;
  onChange: (value: unknown) => void;
  getResponseId?: () => Promise<string>;
  idPrefix: string;
}) {
  const allowTyped = question.settings.allowTyped !== false;
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [typed, setTyped] = useState("");
  const [state, setState] = useState<SaveState>("idle");
  // After a refresh the answer is the stored upload's id: the drawing
  // isn't in the browser any more, so say it's signed and offer to redo.
  const [blank, setBlank] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signedEarlier = typeof value === "string" && value !== "" && blank;

  useEffect(() => () => clearTimeout(timer.current ?? undefined), []);

  function context() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return null;
    return { canvas, ctx };
  }

  function reset() {
    if (canvasRef.current) paintBlank(canvasRef.current);
  }

  // Size the pad once for this screen's pixel density.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    canvas.width = PAD_WIDTH * ratio;
    canvas.height = PAD_HEIGHT * ratio;
    paintBlank(canvas);
  }, [mode]);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * PAD_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * PAD_HEIGHT,
    };
  }

  function clear() {
    clearTimeout(timer.current ?? undefined);
    reset();
    setBlank(true);
    setTyped("");
    setState("idle");
    onChange(undefined);
  }

  /** Uploads what's on the pad a moment after the last stroke; a newer
   * drawing replaces the stored one. */
  function scheduleSave() {
    clearTimeout(timer.current ?? undefined);
    timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
  }

  async function save() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!getResponseId) {
      // Builder preview: no network calls; a stand-in answer.
      onChange("preview-signature");
      setState("saved");
      return;
    }
    setState("saving");
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) throw new Error("no image");
      const responseId = await getResponseId();
      const body = new FormData();
      body.set("file", new File([blob], "signature.png", { type: "image/png" }));
      const res = await fetch(`/api/responses/${responseId}/uploads/${question.id}`, {
        method: "POST",
        body,
      });
      if (!res.ok) throw new Error("refused");
      const data = (await res.json()) as { uploadId: string };
      onChange(data.uploadId);
      setState("saved");
    } catch {
      setState("error");
      onChange(undefined);
    }
  }

  function drawTyped(name: string) {
    reset();
    const c = context();
    if (!c) return;
    const text = name.trim();
    if (!text) return;
    let size = 54;
    c.ctx.textBaseline = "middle";
    do {
      c.ctx.font = `${size}px ${TYPED_FONT}`;
      size -= 2;
    } while (c.ctx.measureText(text).width > PAD_WIDTH - 48 && size > 18);
    c.ctx.fillText(text, 24, PAD_HEIGHT / 2);
  }

  const status =
    state === "saving"
      ? "Saving…"
      : state === "saved"
        ? "Signature saved"
        : state === "error"
          ? null
          : signedEarlier
            ? "Signed. Sign again to replace it."
            : mode === "draw"
              ? "Sign with your finger, a stylus or the mouse."
              : "Type your full name.";

  return (
    <div className="flex max-w-(--st-tile-max) flex-col gap-2.5">
      {question.settings.consentText && (
        <p className="text-[14px] text-(--st-muted)">{question.settings.consentText}</p>
      )}
      {allowTyped && (
        <div role="tablist" aria-label="How to sign" className="flex gap-1.5">
          {(
            [
              ["draw", "Draw", PenLine],
              ["type", "Type", Type],
            ] as const
          ).map(([m, label, Icon]) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                if (mode === m) return;
                clear();
                setMode(m);
              }}
              className={cn(
                "fc-focus inline-flex items-center gap-1.5 rounded-(--st-br) border-[1.5px] px-3 py-1.5 text-[13.5px] font-semibold",
                mode === m
                  ? "border-(--st-primary) bg-(--st-sel)"
                  : "border-(--st-line) bg-(--st-field)",
              )}
            >
              <Icon aria-hidden className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      )}
      {mode === "type" && (
        <input
          id={`${idPrefix}-typed`}
          aria-label="Type your full name to sign"
          autoComplete="name"
          value={typed}
          maxLength={80}
          onChange={(e) => {
            setTyped(e.target.value);
            drawTyped(e.target.value);
            setBlank(e.target.value.trim() === "");
            if (e.target.value.trim()) scheduleSave();
            else clear();
          }}
          className="fc-input w-full rounded-none border-0 border-b-2 border-(--st-line) bg-transparent py-2 text-(length:--st-input) text-(--st-text) outline-none focus:border-(--st-primary)"
          placeholder="Your full name"
        />
      )}
      <div className="relative overflow-hidden rounded-(--st-tile-br) border-[1.5px] border-(--st-line) bg-white">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={
            mode === "draw"
              ? "Signature pad: draw your signature"
              : "Your typed signature"
          }
          className={cn(
            "block aspect-[56/18] w-full touch-none",
            mode === "draw" ? "cursor-crosshair" : "pointer-events-none",
          )}
          onPointerDown={(e) => {
            if (mode !== "draw") return;
            e.currentTarget.setPointerCapture(e.pointerId);
            drawing.current = true;
            last.current = point(e);
            clearTimeout(timer.current ?? undefined);
            const c = context();
            if (c && last.current) {
              // A tap leaves a dot.
              c.ctx.beginPath();
              c.ctx.arc(last.current.x, last.current.y, 1.2, 0, Math.PI * 2);
              c.ctx.fill();
            }
            setBlank(false);
          }}
          onPointerMove={(e) => {
            if (!drawing.current || !last.current) return;
            const c = context();
            if (!c) return;
            const next = point(e);
            c.ctx.beginPath();
            c.ctx.moveTo(last.current.x, last.current.y);
            c.ctx.lineTo(next.x, next.y);
            c.ctx.stroke();
            last.current = next;
          }}
          onPointerUp={() => {
            if (!drawing.current) return;
            drawing.current = false;
            last.current = null;
            scheduleSave();
          }}
          onPointerCancel={() => {
            drawing.current = false;
            last.current = null;
          }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute right-6 bottom-6 left-6 border-b border-dashed border-[#b8b8b8]"
        />
      </div>
      <div className="flex items-center justify-between gap-3 text-[13px] text-(--st-muted)">
        <span role="status" className="flex items-center gap-1.5">
          {state === "saved" && <Check aria-hidden className="size-3.5" />}
          {status}
        </span>
        <button
          type="button"
          onClick={clear}
          disabled={blank && !signedEarlier}
          className="fc-focus font-semibold underline disabled:no-underline disabled:opacity-40"
        >
          Clear
        </button>
      </div>
      {state === "error" && (
        <StageError>
          Your signature couldn&apos;t be saved. Clear it and try again.
        </StageError>
      )}
    </div>
  );
}

// --- products (F-04) --------------------------------------------------------

export function ProductsInput({
  question,
  value,
  onChange,
  idPrefix,
}: {
  question: Extract<QuestionV1, { type: "products" }>;
  value: unknown;
  onChange: (value: unknown) => void;
  idPrefix: string;
}) {
  const qty = quantities(value);
  const { currency, items } = question.settings;
  const order = orderFromAnswer(question, value);

  function set(itemId: string, next: number) {
    const updated: Record<string, number> = {};
    for (const [id, q] of Object.entries(qty)) {
      if (typeof q === "number" && q > 0 && id !== itemId) updated[id] = q;
    }
    if (next > 0) updated[itemId] = next;
    onChange(Object.keys(updated).length ? updated : undefined);
  }

  return (
    <div className="flex max-w-[640px] flex-col gap-2.5">
      <ul className="flex flex-col gap-2.5">
        {items.map((item) => {
          const count = typeof qty[item.id] === "number" ? (qty[item.id] as number) : 0;
          const max = maxQuantity(item);
          const labelId = `${idPrefix}-${item.id}-label`;
          return (
            <li
              key={item.id}
              className={cn(
                "flex items-center gap-3 rounded-(--st-tile-br) border-[1.5px] p-2.5 pr-3",
                count > 0
                  ? "border-(--st-primary) bg-(--st-sel)"
                  : "border-(--st-line) bg-(--st-field)",
              )}
            >
              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- creator-hosted image, any origin the CSP allows
                <img
                  src={item.imageUrl}
                  alt={item.imageAlt ?? ""}
                  className="size-16 shrink-0 rounded-[8px] object-cover"
                />
              ) : (
                <span
                  aria-hidden
                  className="grid size-16 shrink-0 place-items-center rounded-[8px] bg-(--st-hover) text-(--st-muted)"
                >
                  <ImageOff className="size-5" />
                </span>
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <b id={labelId} className="text-[15.5px] leading-tight">
                  {item.label}
                </b>
                {item.description && (
                  <span className="text-[13px] text-(--st-muted)">
                    {item.description}
                  </span>
                )}
                <span className="mt-0.5 text-[14px] font-semibold">
                  {formatMoney(item.price, currency)}
                </span>
              </div>
              <div
                role="group"
                aria-labelledby={labelId}
                className="flex shrink-0 items-center gap-1.5"
              >
                <button
                  type="button"
                  aria-label={`One fewer ${item.label}`}
                  disabled={count === 0}
                  onClick={() => set(item.id, count - 1)}
                  className="fc-focus grid size-8 place-items-center rounded-(--st-br) border-[1.5px] border-(--st-line) bg-(--st-field) disabled:opacity-40"
                >
                  <Minus aria-hidden className="size-4" />
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={max}
                  aria-label={`How many ${item.label}`}
                  value={count}
                  onChange={(e) => {
                    const n = Math.floor(Number(e.target.value));
                    set(item.id, Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0);
                  }}
                  className="fc-input w-11 [appearance:textfield] rounded-sm border-0 bg-transparent text-center text-[15px] font-bold text-(--st-text) outline-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  type="button"
                  aria-label={`One more ${item.label}`}
                  disabled={count >= max}
                  onClick={() => set(item.id, count + 1)}
                  className="fc-focus grid size-8 place-items-center rounded-(--st-br) border-[1.5px] border-(--st-line) bg-(--st-field) disabled:opacity-40"
                >
                  <Plus aria-hidden className="size-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <p
        role="status"
        className="flex items-baseline justify-between border-t-[1.5px] border-(--st-line) pt-2.5 text-[15px]"
      >
        <span className="text-(--st-muted)">Total</span>
        <b className="text-[19px]">{formatMoney(order.total, currency)}</b>
      </p>
    </div>
  );
}
