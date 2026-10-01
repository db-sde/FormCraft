"use client";

import { useMemo, useState } from "react";
import { EyeOff, FlaskConical, Monitor, Smartphone, X } from "lucide-react";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  parseFormSchema,
  validateSemantics,
  compileFormSchema,
  FormSchemaError,
  schemaErrorMessage,
} from "@/domains/forms/schema";
import { FormRuntime } from "@/components/runtime/form-runtime";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

/**
 * Previews the current in-memory draft (including unsaved edits) so
 * the creator sees exactly what they've built, not just what's been
 * autosaved. Compiles client-side on open — a draft that hasn't
 * settled into a publish-valid state yet (e.g. mid-edit, briefly no
 * default ending) shows a friendly notice instead of crashing. Nothing
 * here reaches the network: no analytics events, no response rows —
 * this is what "isolated from production analytics" means for a
 * client-only preview.
 */
export function PreviewDialog({
  schema,
  open,
  onOpenChange,
  onShowProblem,
}: {
  schema: FormSchemaV1;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Take me to it": select the item the problem belongs to. */
  onShowProblem?: (target: { questionId?: string; endingId?: string }) => void;
}) {
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const [run, setRun] = useState(0);

  const result = useMemo(() => {
    try {
      const parsed = parseFormSchema(schema);
      validateSemantics(parsed);
      return { ok: true as const, compiled: compileFormSchema(parsed) };
    } catch (error) {
      if (error instanceof FormSchemaError) {
        return {
          ok: false as const,
          message: schemaErrorMessage(error),
          target: {
            questionId: error.problem?.questionId,
            endingId: error.problem?.endingId,
          },
        };
      }
      return { ok: false as const, message: "Something in this form isn't set up yet." };
    }
  }, [schema]);

  const canJump =
    !result.ok &&
    !!onShowProblem &&
    !!(result.target?.questionId || result.target?.endingId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(780px,calc(100dvh-56px))] w-[min(1180px,calc(100vw-56px))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <div className="border-ink flex flex-wrap items-center gap-3.5 border-b-[1.5px] px-4 py-3">
          <DialogTitle className="font-heading text-[17px] font-bold">
            Preview
          </DialogTitle>
          <DialogDescription className="border-warning bg-accent flex items-center gap-1.5 rounded-full border-[1.5px] px-2.5 py-1 text-[12.5px] font-semibold text-[var(--chip-draft-fg)]">
            <FlaskConical className="size-[13px]" />
            Preview mode: answers aren&apos;t saved
          </DialogDescription>
          <span className="flex-1" />
          <div
            role="radiogroup"
            aria-label="Device"
            className="border-ink bg-background flex gap-0.5 rounded-[8px] border-[1.5px] p-[3px]"
          >
            {(
              [
                ["desktop", "Desktop", Monitor],
                ["phone", "Mobile", Smartphone],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={device === id}
                onClick={() => setDevice(id)}
                className={cn(
                  "fc-focus flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-[13.5px] font-semibold",
                  device === id
                    ? "bg-secondary text-secondary-foreground"
                    : "hover:bg-hover-wash",
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-border h-[34px]"
            onClick={() => setRun((n) => n + 1)}
            disabled={!result.ok}
          >
            Restart
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-[34px]"
            aria-label="Close preview"
            onClick={() => onOpenChange(false)}
          >
            <X />
          </Button>
        </div>

        <div className="bg-board grid min-h-0 flex-1 place-items-center p-5">
          {!result.ok ? (
            <div className="flex max-w-[420px] flex-col items-center gap-2.5 text-center">
              <span className="border-ink shadow-card grid size-[52px] -rotate-6 place-items-center rounded-[12px] border-[1.5px] bg-[var(--alert-error-bg)]">
                <EyeOff className="text-destructive size-6" />
              </span>
              <b className="font-heading text-[22px]">Unable to preview this form.</b>
              <span className="text-muted-foreground text-[14.5px] leading-normal">
                {result.message}
              </span>
              {canJump && (
                <Button
                  className="mt-1.5"
                  onClick={() => {
                    onShowProblem?.(result.target ?? {});
                    onOpenChange(false);
                  }}
                >
                  Take me to it
                </Button>
              )}
            </div>
          ) : device === "desktop" ? (
            <div className="border-ink size-full max-w-[1100px] overflow-hidden rounded-lg border-[1.5px] bg-white">
              <FormRuntime
                key={`d-${run}`}
                compiled={result.compiled}
                mode="desktop"
                className="h-full"
              />
            </div>
          ) : (
            <div className="border-ink shadow-lift h-full max-h-[700px] w-[375px] max-w-full overflow-hidden rounded-[32px] border-[1.5px] bg-white">
              <FormRuntime
                key={`p-${run}`}
                compiled={result.compiled}
                mode="phone"
                className="h-full"
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
