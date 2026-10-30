"use client";

import { useActionState } from "react";
import { Link2, X } from "lucide-react";
import { importFormAction } from "@/app/(dashboard)/actions";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";

/** "Import from a link" (F-05) on the new-form page: a public Google Form
 * or typeform becomes a draft to review before publishing. */
export function ImportFormCard() {
  const [state, action] = useActionState(importFormAction, null);
  return (
    <form
      action={action}
      className="border-ink bg-card flex flex-col gap-3 rounded-lg border-[1.5px] px-5 py-4"
    >
      <label htmlFor="import-url" className="flex items-center gap-[18px]">
        <span className="border-ink shadow-raised grid size-11 shrink-0 place-items-center rounded-sm border-[1.5px] bg-[var(--qt-text-bg)] text-[var(--qt-text-fg)]">
          <Link2 className="size-5" />
        </span>
        <span className="flex flex-col gap-[3px]">
          <span className="font-heading text-lg leading-[1.2] font-bold">
            Import from a link
          </span>
          <span className="text-muted-foreground text-sm">
            A public Google Form or typeform becomes a draft here, with a report of what
            came over. Responses stay where they are.
          </span>
        </span>
      </label>
      <Input
        id="import-url"
        name="url"
        type="url"
        inputMode="url"
        maxLength={2000}
        placeholder="https://docs.google.com/forms/d/e/…/viewform"
      />
      {state?.message && (
        <p role="alert" className="text-destructive flex items-start gap-1.5 text-sm">
          <X className="mt-0.5 size-3.5 shrink-0" /> {state.message}
        </p>
      )}
      <SubmitButton className="self-start" icon={<Link2 />} pendingLabel="Importing…">
        Import form
      </SubmitButton>
    </form>
  );
}
