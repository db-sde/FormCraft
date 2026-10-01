"use client";

import { useState, useTransition } from "react";
import { useStoredValue } from "@/lib/hooks/use-stored-value";
import { useRouter } from "next/navigation";
import { ArrowRight, LayoutTemplate, Plus, Sparkles } from "lucide-react";
import { createFormAction, createSampleFormAction } from "@/app/(dashboard)/actions";
import { cn } from "cn";
import { Button, ButtonSpinner } from "@/components/ui/button";
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
    body: "A blank form with a welcome screen and one question.",
    icon: Plus,
    tint: "var(--qt-screens-bg)",
    cta: "Create blank form",
  },
];

/**
 * First sign-in (Part 3 §10.9): a welcome dialog over the empty
 * dashboard asking how to start. Shown once per browser.
 */
export function OnboardingDialog({ firstName }: { firstName: string }) {
  const router = useRouter();
  // Closed on the server pass; opens once the browser says it is unseen.
  const [seen, markSeen] = useStoredValue(SEEN_KEY, "1");
  const [closed, setClosed] = useState(false);
  const open = seen !== "1" && !closed;
  const [choice, setChoice] = useState<Choice>("sample");
  const [pending, startTransition] = useTransition();

  function close() {
    setClosed(true);
    markSeen("1");
  }

  function go() {
    const selected = choice;
    if (selected === "template") {
      close();
      router.push("/templates");
      return;
    }
    startTransition(async () => {
      markSeen("1");
      await (selected === "sample" ? createSampleFormAction() : createFormAction());
    });
  }

  const cta = CHOICES.find((c) => c.id === choice)!.cta;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent showCloseButton={false} className="gap-[22px] p-8 sm:max-w-[720px]">
        <div className="flex flex-col gap-2">
          <span className="dark:text-primary text-[11.5px] font-bold tracking-[0.1em] text-[#9a6a0c] uppercase">
            Welcome to FormCraft{firstName ? `, ${firstName}` : ""}
          </span>
          <DialogTitle className="text-[34px] leading-[1.05] tracking-[-0.03em]">
            How do you want to start?
          </DialogTitle>
          <DialogDescription className="text-[15px]">
            You can always do the others later.
          </DialogDescription>
        </div>
        <div
          role="radiogroup"
          aria-label="How to start"
          className="grid gap-3.5 sm:grid-cols-3"
        >
          {CHOICES.map((c) => {
            const selected = c.id === choice;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setChoice(c.id)}
                onDoubleClick={go}
                className={cn(
                  "fc-focus border-ink flex flex-col items-start gap-2.5 rounded-lg border-[1.5px] p-4 text-left transition-[transform,box-shadow]",
                  selected
                    ? "shadow-lift dark:bg-accent -translate-x-0.5 -translate-y-0.5 bg-[#fff4d6]"
                    : "bg-card hover:bg-accent",
                )}
              >
                <span
                  className="border-ink grid size-10 place-items-center rounded-lg border-[1.5px] text-[#2b2118]"
                  style={{ background: c.tint }}
                >
                  <c.icon className="size-5 stroke-[1.75]" />
                </span>
                <b className="font-heading text-[17px]">{c.title}</b>
                <span className="text-muted-foreground text-[13.5px] leading-[1.45]">
                  {c.body}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={close}
            className="fc-focus text-muted-foreground hover:text-foreground rounded-xs text-sm font-semibold"
          >
            Skip for now
          </button>
          <Button
            onClick={go}
            disabled={pending}
            data-loading={pending || undefined}
            className="shadow-card h-11 px-5 text-[15px]"
          >
            {pending ? <ButtonSpinner /> : null}
            {pending ? "Creating…" : cta}
            {!pending && <ArrowRight />}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
