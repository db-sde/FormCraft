"use client";

import { useState, useTransition } from "react";
import { useStoredValue } from "@/lib/hooks/use-stored-value";
import { useRouter } from "next/navigation";
import { ArrowRight, LayoutTemplate, Plus, Sparkles } from "lucide-react";
import { createFormAction, createSampleFormAction } from "@/app/(dashboard)/actions";
import { ButtonSpinner } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

const SEEN_KEY = "fc-welcome-seen";

type Choice = "sample" | "template" | "scratch";

const CHOICES: {
  id: Choice;
  title: string;
  body: string;
  icon: typeof Sparkles;
  tint: string;
  cta: string;
}[] = [
  {
    id: "sample",
    title: "Try a sample form",
    body: "A ready-made feedback survey with logic, so you can poke around.",
    icon: Sparkles,
    tint: "var(--qt-choice-bg)",
    cta: "Open sample form",
  },
  {
    id: "template",
    title: "Pick a template",
    body: "Starting points for feedback, events, hiring and leads.",
    icon: LayoutTemplate,
    tint: "var(--qt-text-bg)",
    cta: "Browse templates",
  },
  {
    id: "scratch",
    title: "Start from scratch",
    body: "A short contact form to reshape: a welcome, a question and contact details.",
    icon: Plus,
    tint: "var(--qt-screens-bg)",
    cta: "Create blank form",
  },
];

/**
 * First sign-in (Part 3 §10.9): a welcome dialog over the empty
 * dashboard asking how to start — each card starts that way with one
 * click. Shown once per browser.
 */
export function OnboardingDialog({ firstName }: { firstName: string }) {
  const router = useRouter();
  // Closed on the server pass; opens once the browser says it is unseen.
  const [seen, markSeen] = useStoredValue(SEEN_KEY, "1");
  const [closed, setClosed] = useState(false);
  const open = seen !== "1" && !closed;
  // The card that was clicked, while its form is being made.
  const [starting, setStarting] = useState<Choice | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setClosed(true);
    markSeen("1");
  }

  /** Each card does its thing straight away: one click, no confirm. */
  function go(selected: Choice) {
    if (pending) return;
    if (selected === "template") {
      close();
      router.push("/templates");
      return;
    }
    setStarting(selected);
    startTransition(async () => {
      markSeen("1");
      await (selected === "sample" ? createSampleFormAction() : createFormAction());
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent showCloseButton={false} className="gap-[22px] p-8 sm:max-w-[720px]">
        <div className="flex flex-col gap-2">
          <span className="dark:text-primary text-[11.5px] font-bold tracking-[0.1em] text-[var(--chip-draft-fg)] uppercase">
            Welcome to FormCraft{firstName ? `, ${firstName}` : ""}
          </span>
          <DialogTitle className="text-[34px] leading-[1.05] tracking-[-0.03em]">
            How do you want to start?
          </DialogTitle>
          <DialogDescription className="text-[15px]">
            You can always do the others later.
          </DialogDescription>
        </div>
        <div className="grid gap-3.5 sm:grid-cols-3">
          {CHOICES.map((c) => {
            const busy = pending && starting === c.id;
            return (
              <button
                key={c.id}
                type="button"
                disabled={pending}
                data-loading={busy || undefined}
                onClick={() => go(c.id)}
                className="fc-focus border-ink bg-card hover:bg-accent hover:shadow-lift flex flex-col items-start gap-2.5 rounded-lg border-[1.5px] p-4 text-left transition-[transform,box-shadow] hover:-translate-x-0.5 hover:-translate-y-0.5 disabled:opacity-60 data-[loading=true]:opacity-100"
              >
                <span
                  className="border-ink grid size-10 place-items-center rounded-lg border-[1.5px] text-[#2b2118]"
                  style={{ background: c.tint }}
                >
                  {busy ? <ButtonSpinner /> : <c.icon className="size-5 stroke-[1.75]" />}
                </span>
                <b className="font-heading text-[17px]">{c.title}</b>
                <span className="text-muted-foreground text-[13.5px] leading-[1.45]">
                  {c.body}
                </span>
                <span className="mt-auto flex items-center gap-1 pt-1 text-[13.5px] font-bold">
                  {busy ? "Creating…" : c.cta}{" "}
                  {!busy && <ArrowRight className="size-4" />}
                </span>
              </button>
            );
          })}
        </div>
        <div>
          <button
            type="button"
            onClick={close}
            className="fc-focus text-muted-foreground hover:text-foreground rounded-xs text-sm font-semibold"
          >
            Skip for now
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
