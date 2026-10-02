"use client";

import { useState, useTransition } from "react";
import { StageButton } from "@/components/runtime/stage";
import { retryPaymentAction } from "./actions";

export function RetryPayment({ responseId }: { responseId: string }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-2">
      <StageButton
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await retryPaymentAction(responseId);
            setMessage(result.message);
          })
        }
      >
        {pending ? "Opening the payment…" : "Try the payment again"}
      </StageButton>
      {message && <p className="text-sm text-(--st-muted)">{message}</p>}
    </div>
  );
}
