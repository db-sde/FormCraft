"use client";

import { useMemo, useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  parseFormSchema,
  validateSemantics,
  compileFormSchema,
  FormSchemaError,
} from "@/domains/forms/schema";
import { FormRuntime } from "@/components/runtime/form-runtime";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
}: {
  schema: FormSchemaV1;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");

  const result = useMemo(() => {
    try {
      const parsed = parseFormSchema(schema);
      validateSemantics(parsed);
      return { ok: true as const, compiled: compileFormSchema(parsed) };
    } catch (error) {
      const message =
        error instanceof FormSchemaError ? error.message : "Unable to preview this form.";
      return { ok: false as const, message };
    }
  }, [schema]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-w-3xl flex-col gap-4 sm:max-w-3xl">
        <DialogHeader className="flex-row items-center justify-between space-y-0">
          <DialogTitle>Preview</DialogTitle>
          <div className="mr-8 flex items-center gap-1 rounded-md border p-0.5">
            <Button
              type="button"
              variant={device === "desktop" ? "secondary" : "ghost"}
              size="icon-sm"
              aria-label="Desktop preview"
              onClick={() => setDevice("desktop")}
            >
              <Monitor className="size-4" />
            </Button>
            <Button
              type="button"
              variant={device === "mobile" ? "secondary" : "ghost"}
              size="icon-sm"
              aria-label="Mobile preview"
              onClick={() => setDevice("mobile")}
            >
              <Smartphone className="size-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="bg-muted/30 flex justify-center rounded-lg p-6">
          {!result.ok ? (
            <div className="text-muted-foreground flex min-h-[420px] w-full max-w-md items-center justify-center rounded-lg border border-dashed p-10 text-center text-sm">
              Can&apos;t preview yet: {result.message}
            </div>
          ) : (
            <div
              className={cn(
                "overflow-hidden rounded-lg border shadow-sm transition-all",
                device === "desktop" ? "w-full max-w-2xl" : "w-full max-w-[375px]",
              )}
            >
              <FormRuntime key={device} compiled={result.compiled} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
