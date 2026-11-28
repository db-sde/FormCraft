"use client";

import { useActionState, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { generateFormAction } from "@/app/(dashboard)/actions";
import { SubmitButton } from "@/components/submit-button";
import { Textarea } from "@/components/ui/textarea";
import { NotSetUpYet } from "@/components/not-set-up-yet";

/** "Describe your form" on the new-form page. The result opens in the
 * builder as an ordinary draft, to review and edit before publishing. */
export function GenerateFormCard({
  enabled,
  lockedReason = null,
}: {
  enabled: boolean;
  /** Not on the plan: said before anything's typed (QA FC15-26). */
  lockedReason?: string | null;
}) {
  const [state, action] = useActionState(generateFormAction, null);
  // Kept when generating fails, so it can be edited and tried again.
  const [prompt, setPrompt] = useState("");

  // Until the server has an AI key, a friendly note stands in for it.
  if (!enabled)
    return (
      <NotSetUpYet feature="Writing forms with AI">
        Meanwhile, start from scratch above or pick a template below.
      </NotSetUpYet>
    );

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
      {lockedReason && <p className="text-muted-foreground text-sm">{lockedReason}</p>}
      <Textarea
        id="generate-prompt"
        name="prompt"
        rows={3}
        maxLength={2000}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={!!lockedReason}
        placeholder="A 10-question JavaScript quiz that shows a different ending for beginners, intermediates and experts"
      />
      {state?.message && (
        <p role="alert" className="text-destructive flex items-start gap-1.5 text-sm">
          <X className="mt-0.5 size-3.5 shrink-0" /> {state.message}
        </p>
      )}
      <SubmitButton
        disabled={!!lockedReason}
        className="self-start"
        icon={<Sparkles />}
        pendingLabel="Drafting your form…"
      >
        Generate form
      </SubmitButton>
    </form>
  );
}
