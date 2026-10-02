"use client";

import { useActionState } from "react";
import { Sparkles, X } from "lucide-react";
import { generateFormAction } from "@/app/(dashboard)/actions";
import { SubmitButton } from "@/components/submit-button";
import { Textarea } from "@/components/ui/textarea";

/** "Describe your form" on the new-form page. The result opens in the
 * builder as an ordinary draft, to review and edit before publishing. */
export function GenerateFormCard({ enabled }: { enabled: boolean }) {
  const [state, action] = useActionState(generateFormAction, null);

  if (!enabled) {
    return (
      <div className="border-input text-muted-foreground flex items-center gap-2.5 rounded-lg border-[1.5px] border-dashed px-5 py-4 text-sm">
        <Sparkles className="size-4 shrink-0" />
        Generating a form from a description needs AI, which isn&apos;t set up on this
        server (set ANTHROPIC_API_KEY).
      </div>
    );
  }

  return (
    <form
      action={action}
      className="border-ink bg-card flex flex-col gap-3 rounded-lg border-[1.5px] px-5 py-4"
    >
      <label htmlFor="generate-prompt" className="flex items-center gap-[18px]">
        <span className="border-ink shadow-raised grid size-11 shrink-0 place-items-center rounded-sm border-[1.5px] bg-[var(--qt-other-bg)] text-[var(--qt-other-fg)]">
          <Sparkles className="size-5" />
        </span>
        <span className="flex flex-col gap-[3px]">
          <span className="font-heading text-lg leading-[1.2] font-bold">
            Describe your form
          </span>
          <span className="text-muted-foreground text-sm">
            Questions, endings and any scoring or branching, drafted for you to edit.
          </span>
        </span>
      </label>
      <Textarea
        id="generate-prompt"
        name="prompt"
        rows={3}
        maxLength={2000}
        placeholder="A 10-question JavaScript quiz that shows a different ending for beginners, intermediates and experts"
      />
      {state?.message && (
        <p role="alert" className="text-destructive flex items-start gap-1.5 text-sm">
          <X className="mt-0.5 size-3.5 shrink-0" /> {state.message}
        </p>
      )}
      <SubmitButton
        className="self-start"
        icon={<Sparkles />}
        pendingLabel="Drafting your form…"
      >
        Generate form
      </SubmitButton>
    </form>
  );
}
