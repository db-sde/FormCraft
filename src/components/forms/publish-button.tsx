"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Rocket } from "lucide-react";
import { toast } from "sonner";
import { publishAction } from "@/app/(form)/forms/[id]/actions";
import { Button } from "@/components/ui/button";

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
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await publishAction(formId);
          if (result.ok) {
            toast.success("Your form is live");
            router.refresh();
          } else {
            toast.error("Couldn't publish", { description: result.message });
          }
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <Rocket />}
      {pending ? "Publishing…" : label}
    </Button>
  );
}
