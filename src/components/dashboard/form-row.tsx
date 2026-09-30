"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Copy,
  Eye,
  EyeOff,
  Inbox,
  Link2,
  MoreHorizontal,
  Pencil,
  Rocket,
  Send,
  TextCursorInput,
  Trash2,
} from "lucide-react";
import {
  publishAction,
  renameFormAction,
  unpublishAction,
} from "@/app/(form)/forms/[id]/actions";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { FormListItem } from "@/domains/forms";
import { duplicateFormAction, deleteFormAction } from "@/app/(dashboard)/actions";
import { Button } from "@/components/ui/button";
import { FormStatusBadge } from "@/components/forms/form-status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LocalTime } from "@/components/local-time";

export function FormRow({ form }: { form: FormListItem }) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(form.title);
  const [pending, startTransition] = useTransition();

  function copyLink() {
    const url = `${window.location.origin}/f/${form.slug}`;
    navigator.clipboard.writeText(url).then(
      () => toast.success("Link copied", { description: url }),
      () => toast.error("Couldn't copy the link", { description: url }),
    );
  }

  function rename() {
    startTransition(async () => {
      const result = await renameFormAction(form.id, newTitle);
      if (result.ok) {
        setRenaming(false);
        toast.success("Renamed");
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  function togglePublished() {
    startTransition(async () => {
      if (form.publishState === "live") {
        const result = await unpublishAction(form.id);
        if (result.ok) toast("Unpublished", { description: "The public link is off." });
        else toast.error(result.message);
      } else {
        const result = await publishAction(form.id);
        if (result.ok) toast.success("Published", { description: "Your form is live." });
        else toast.error("Couldn't publish", { description: result.message });
      }
      router.refresh();
    });
  }

  function duplicate() {
    startTransition(async () => {
      const result = await duplicateFormAction(form.id);
      if (result.ok) {
        toast.success("Form duplicated");
        router.push(`/forms/${result.id}`);
      } else {
        toast.error(result.message);
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteFormAction(form.id);
      if (result.ok) {
        setConfirmDelete(false);
        toast.success(`Deleted "${form.title}"`);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <>
      <div className="hover:bg-muted/40 relative flex items-center gap-3 px-4 py-3.5 transition-colors sm:gap-4">
        <span
          aria-hidden
          className="bg-accent text-accent-foreground grid size-9 shrink-0 place-items-center rounded-lg text-sm font-semibold"
        >
          {form.title.trim().charAt(0).toUpperCase() || "F"}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {/* The whole row opens the builder via this link's ::after
                overlay; the counts and menu sit above it (z-10). */}
            <Link
              href={`/forms/${form.id}`}
              className="truncate font-medium after:absolute after:inset-0 after:content-['']"
            >
              {form.title}
            </Link>
            <FormStatusBadge state={form.publishState} />
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Edited <LocalTime iso={form.updatedAt} variant="relative" />
            <span className="sm:hidden">
              {" "}
              · {form.responseCount} completed · {form.incompleteCount} incomplete
            </span>
          </p>
        </div>

        <div className="relative z-10 hidden items-center gap-6 text-sm sm:flex">
          <Link
            href={`/forms/${form.id}/responses`}
            className="hover:text-primary w-24 text-right"
          >
            <span className="font-semibold tabular-nums">{form.responseCount}</span>{" "}
            <span className="text-muted-foreground">completed</span>
          </Link>
          <Link
            href={`/forms/${form.id}/responses?view=incomplete`}
            className="hover:text-primary w-24 text-right"
          >
            <span className="font-semibold tabular-nums">{form.incompleteCount}</span>{" "}
            <span className="text-muted-foreground">incomplete</span>
          </Link>
        </div>

        <div className="relative z-10 flex shrink-0 items-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Actions for "${form.title}"`}
                disabled={pending}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem asChild>
                <Link href={`/forms/${form.id}`}>
                  <Pencil /> Edit
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/forms/${form.id}?preview=1`}>
                  <Eye /> Preview
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setNewTitle(form.title);
                  setRenaming(true);
                }}
              >
                <TextCursorInput /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/forms/${form.id}/share`}>
                  <Send /> Share
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/forms/${form.id}/responses`}>
                  <Inbox /> Responses
                </Link>
              </DropdownMenuItem>
              {form.hasPublishedVersion && (
                <DropdownMenuItem onSelect={copyLink}>
                  <Link2 /> Copy link
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={togglePublished}>
                {form.publishState === "live" ? (
                  <>
                    <EyeOff /> Unpublish
                  </>
                ) : (
                  <>
                    <Rocket /> Publish
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={duplicate}>
                <Copy /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setConfirmDelete(true)}
              >
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename form</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              rename();
            }}
          >
            <Input
              aria-label="Form name"
              value={newTitle}
              maxLength={200}
              onChange={(e) => setNewTitle(e.target.value)}
              autoFocus
            />
            <DialogFooter className="mt-4">
              <Button type="button" variant="ghost" onClick={() => setRenaming(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !newTitle.trim()}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{form.title}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              {form.hasPublishedVersion
                ? "Its public link will stop working immediately. "
                : ""}
              The form will disappear from your dashboard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                remove();
              }}
            >
              {pending ? "Deleting…" : "Delete form"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
