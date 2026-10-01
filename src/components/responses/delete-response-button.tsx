"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteResponseAction } from "@/app/(form)/forms/[id]/(sections)/responses/actions";
import { Button, ButtonSpinner } from "@/components/ui/button";
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
  who,
  variant = "icon",
}: {
  formId: string;
  responseId: string;
  /** Whose answers, for the confirmation ("Maya Rao's answers…"). */
  who?: string;
  /** "outline": a bordered 36px tile, for the response detail header. */
  variant?: "icon" | "outline";
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
        toast.success("Response deleted.");
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
      } else {
        toast.error("Couldn't delete that response.", {
          description: "Nothing was removed. Try again.",
        });
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant={variant === "outline" ? "outline" : "ghost"}
        size={variant === "outline" ? "icon" : "icon-sm"}
        className={
          variant === "outline"
            ? "text-destructive hover:text-destructive size-9"
            : "text-destructive hover:text-destructive hover:bg-hover-wash-strong size-8"
        }
        aria-label="Delete response"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-4" />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this response?</AlertDialogTitle>
            <AlertDialogDescription>
              {who ? `${who}'s answers` : "These answers"} will be removed for good,
              including any uploaded files. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              data-loading={pending || undefined}
              disabled={pending}
              onClick={(e) => {
                // Stay open, showing "Deleting…", until the server answers.
                e.preventDefault();
                confirmDelete();
              }}
            >
              {pending && <ButtonSpinner />}
              {pending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
