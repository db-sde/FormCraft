"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { sendSentryTestAction } from "../../actions";

/** Sends a test error to Sentry and shows the id to look for there. */
export function SentryTest({ configured }: { configured: boolean }) {
  const [pending, start] = useTransition();
  const [eventId, setEventId] = useState<string | null>(null);
  return (
    <section className="border-border flex flex-col gap-2 rounded-lg border-[1.5px] p-4">
      <h2 className="font-semibold">Error reporting</h2>
      <p className="text-muted-foreground text-sm">
        {configured
          ? "Send a test error to check that Sentry receives them. It appears in Sentry's Issues as “SentryTestError”, tagged source: staff_portal."
          : "Sentry isn't set up: NEXT_PUBLIC_SENTRY_DSN is empty, so errors are only logged."}
      </p>
      {configured && (
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await sendSentryTestAction();
                if (result.ok) {
                  setEventId(result.eventId);
                  toast.success("Test error sent to Sentry.");
                } else toast.error(result.error);
              })
            }
          >
            {pending ? "Sending…" : "Send test error"}
          </Button>
        </div>
      )}
      {eventId && (
        <p className="text-sm" role="status">
          Sent. In Sentry, search Issues for event id <code>{eventId}</code>.
        </p>
      )}
    </section>
  );
}
