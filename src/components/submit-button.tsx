"use client";

import { useFormStatus } from "react-dom";
import { Button, ButtonSpinner } from "@/components/ui/button";

/**
 * A submit button for server-action forms: disabled with a spinner
 * while its form is submitting, so the click gets immediate feedback
 * and a double-click can't run the action twice (e.g. create two
 * forms). While pending it keeps its colours and shows the 14px
 * spinner with the "…ing" label, as the design system specifies.
 */
export function SubmitButton({
  icon,
  pendingLabel,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "type"> & {
  icon?: React.ReactNode;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending || props.disabled}
      aria-busy={pending}
      data-loading={pending || undefined}
      {...props}
    >
      {pending ? <ButtonSpinner /> : icon}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
