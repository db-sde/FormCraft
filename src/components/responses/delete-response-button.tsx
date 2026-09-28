"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteResponseAction } from "@/app/(dashboard)/forms/[id]/responses/actions";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

export function DeleteResponseButton({
  formId,
  responseId,
  redirectTo,
}: {
  formId: string;
  responseId: string;
  /** If set, navigates here after a successful delete (used on the
   * detail page, which no longer has anything to show once its own
   * response is gone). Omit on the list page, where the row just
   * disappears in place. */
  redirectTo?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function confirmDelete() {
    startTransition(async () => {
      const result = await deleteResponseAction(formId, responseId);
      setOpen(false);
      if (result.ok) {
        toast("Response deleted");
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
      } else {
        toast.error("Couldn't delete response");
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="text-destructive hover:text-destructive"
        aria-label="Delete response"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-3.5" />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this response?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the response and its answers. This can&apos;t be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={pending}>
              {pending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
