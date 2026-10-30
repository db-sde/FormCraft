"use client";

import { useState, useTransition } from "react";
import { CircleAlert, CircleCheck, CircleDashed, FileInput, X } from "lucide-react";
import { IMPORT_SOURCE_LABEL, type ImportReport } from "@/domains/forms/import/report";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "cn";

const STATUS = {
  imported: { icon: CircleCheck, label: "Imported", tone: "text-[var(--chip-live-fg)]" },
  converted: {
    icon: CircleDashed,
    label: "Converted",
    tone: "text-[var(--chip-draft-fg)]",
  },
  unknown: { icon: CircleAlert, label: "Left out", tone: "text-destructive" },
} as const;

/** What an import (F-05) brought over, shown in the builder until the
 * creator dismisses it. */
export function ImportReportNotice({
  report,
  onDismiss,
}: {
  report: ImportReport;
  onDismiss: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();
  if (hidden) return null;

  const count = (status: keyof typeof STATUS) =>
    report.fields.filter((f) => f.status === status).length;
  const source = IMPORT_SOURCE_LABEL[report.source];

  return (
    <>
      <div
        role="status"
        className="border-ink bg-card shadow-raised sticky top-3 z-20 mx-auto mt-3 flex w-[min(640px,calc(100%-24px))] flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border-[1.5px] px-4 py-2.5 text-sm"
      >
        <FileInput className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <b>Imported from {source}.</b> {count("imported")} imported,{" "}
          {count("converted")} converted, {count("unknown")} left out
          {report.logic.imported > 0 ? `, ${report.logic.imported} logic jumps` : ""}.
          Review it before publishing.
        </span>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          See report
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Dismiss the import report"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await onDismiss();
              setHidden(true);
            })
          }
        >
          <X className="size-4" />
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Import report</DialogTitle>
            <DialogDescription>
              From {source}: what came over, what changed shape, and what was left out.
              Nothing is published until you publish it.
            </DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-2">
            {report.fields.map((field, i) => {
              const s = STATUS[field.status];
              return (
                <li key={i} className="flex gap-2.5 text-sm">
                  <s.icon className={cn("mt-0.5 size-4 shrink-0", s.tone)} aria-hidden />
                  <span className="min-w-0">
                    <b>{field.label || "Untitled"}</b>{" "}
                    <span className={cn("text-xs font-semibold", s.tone)}>{s.label}</span>
                    {field.note && (
                      <span className="text-muted-foreground block text-[13px]">
                        {field.note}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          <section className="flex flex-col gap-1.5 text-sm">
            <h3 className="font-bold">Logic</h3>
            <p className="text-muted-foreground">
              {report.logic.imported > 0
                ? `${report.logic.imported} jump${report.logic.imported === 1 ? "" : "s"} rebuilt as logic rules. Check them in Logic.`
                : "No logic was rebuilt."}
            </p>
            {report.logic.notes.map((note, i) => (
              <p key={i} className="text-muted-foreground text-[13px]">
                • {note}
              </p>
            ))}
          </section>
          {report.notes.length > 0 && (
            <section className="flex flex-col gap-1.5 text-sm">
              <h3 className="font-bold">Also</h3>
              {report.notes.map((note, i) => (
                <p key={i} className="text-muted-foreground text-[13px]">
                  • {note}
                </p>
              ))}
            </section>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
