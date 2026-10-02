"use client";

import { useState, useTransition } from "react";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { acceptInvitationAction } from "@/app/(dashboard)/settings/team-actions";

export function AcceptInvitation({ token }: { token: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await acceptInvitationAction(token);
            if (!result.ok) setError(result.message);
          })
        }
      >
        {pending && <ButtonSpinner />}
        {pending ? "Joining…" : "Accept invitation"}
      </Button>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
