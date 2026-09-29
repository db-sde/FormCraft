"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A submit button for server-action forms: disabled with a spinner
 * while its form is submitting, so the click gets immediate feedback
 * and a double-click can't run the action twice (e.g. create two
 * forms).
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
      {...props}
    >
      {pending ? <Loader2 className="animate-spin" /> : icon}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
