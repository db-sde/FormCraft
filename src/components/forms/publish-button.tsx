"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { publishAction } from "@/app/(form)/forms/[id]/actions";
import { Button, ButtonSpinner } from "@/components/ui/button";

/** Publishes the saved draft from pages other than the builder (the
 * builder has its own, which first flushes unsaved edits). */
export function PublishButton({
  formId,
  label = "Publish",
  size,
}: {
  formId: string;
  label?: string;
  size?: "default" | "lg";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      size={size}
      className={size ? undefined : "h-[38px]"}
      data-loading={pending || undefined}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await publishAction(formId);
          if (result.ok) {
            toast.success("Published.", { description: "Your form is live." });
            router.refresh();
          } else {
            toast.error("Couldn't publish.", { description: result.message });
          }
        })
      }
    >
      {pending && <ButtonSpinner />}
      {pending ? "Publishing…" : label}
    </Button>
  );
}
