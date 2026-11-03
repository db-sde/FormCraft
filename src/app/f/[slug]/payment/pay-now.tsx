"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ThemeV1 } from "@/domains/forms/schema/v1";
import type { Quote } from "@/domains/payments/flow";
import { PaymentStep } from "@/components/runtime/payment-step";
import { StageButton } from "@/components/runtime/stage";

/** Paying from the payment link (F-22): the same payment step as in the
 * form, for a response that hasn't been paid. */
export function PayNow({
  theme,
  responseId,
  quote,
  label,
}: {
  theme: ThemeV1;
  responseId: string;
  quote: Quote;
  label: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <StageButton onClick={() => setOpen(true)}>{label}</StageButton>
      {open && (
        <PaymentStep
          theme={theme}
          responseId={responseId}
          initialQuote={quote}
          payLaterUrl={null}
          onPaid={() => {
            setOpen(false);
            router.refresh();
          }}
          onLater={() => setOpen(false)}
          onRedirect={(url) => window.location.assign(url)}
        />
      )}
    </>
  );
}
