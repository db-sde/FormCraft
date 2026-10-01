"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setNotificationsAction } from "@/app/(form)/forms/[id]/(sections)/settings/actions";
import { Switch } from "@/components/ui/switch";

/** "Email me about new responses" (Part 5, Email notifications). Goes
 * to the form owner; the email links to the response, never includes
 * the answers. */
export function NotificationsPanel({
  formId,
  initialEnabled,
  ownerEmail,
  emailConfigured,
}: {
  formId: string;
  initialEnabled: boolean;
  ownerEmail: string;
  emailConfigured: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, startTransition] = useTransition();

  function save(next: boolean) {
    setEnabled(next);
    startTransition(async () => {
      const result = await setNotificationsAction(formId, next);
      if (result.ok) {
        toast.success(next ? "Notifications on." : "Notifications off.");
      } else {
        setEnabled(!next);
        toast.error("Couldn't save that.", { description: result.message });
      }
    });
  }

  return (
    <div className="border-ink bg-card flex flex-col gap-3 rounded-lg border-[1.5px] p-3.5">
      <label className="flex cursor-pointer items-center justify-between gap-4">
        <span className="flex flex-col gap-0.5">
          <b className="text-[14.5px]">Email me about new responses</b>
          <span className="text-muted-foreground text-[12.5px]">
            The email never includes answers, just a link to them
          </span>
        </span>
        <Switch checked={enabled} disabled={pending} onCheckedChange={save} />
      </label>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13.5px] font-semibold">Send to</span>
        <span className="border-border bg-background flex h-7 items-center self-start rounded-full border-[1.5px] px-2.5 text-[13px] font-semibold">
          {ownerEmail || "The form owner"}
        </span>
      </div>
      {!emailConfigured && (
        <p className="rounded-sm bg-[var(--alert-warning-bg)] px-3 py-2 text-[13px] text-[var(--alert-warning-fg)]">
          Email sending isn&apos;t set up on this server yet, so no emails go out until an
          administrator adds it.
        </p>
      )}
    </div>
  );
}
