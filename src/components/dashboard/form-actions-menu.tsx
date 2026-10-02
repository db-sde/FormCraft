"use client";

import { createContext, useContext, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast";
import {
  Copy,
  Ellipsis,
  EllipsisVertical,
  Eye,
  EyeOff,
  Inbox,
  Link2,
  Link2Off,
  PencilLine,
  Rocket,
  Send,
  TextCursorInput,
  Trash2,
  FolderInput,
} from "lucide-react";
import {
  publishAction,
  renameFormAction,
  unpublishAction,
} from "@/app/(form)/forms/[id]/actions";
import {
  duplicateFormAction,
  deleteFormAction,
  moveFormToFolderAction,
} from "@/app/(dashboard)/actions";
import type { FormListItem } from "@/domains/forms";
import { Input } from "@/components/ui/input";
import { Button, ButtonSpinner } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "cn";

/**
 * The ⋯ menu on a form card or row, with its rename and delete dialogs.
 * `onDuplicating` lets the list show a "Duplicating…" placeholder card
 * while the copy is made.
 */
/** Viewers get the read-only parts of the menu (set by FormsBrowser). */
export const CanEditContext = createContext(true);
/** The workspace's folders, for "Move to folder". */
export const FoldersContext = createContext<{ id: string; name: string }[]>([]);

export function FormActionsMenu({
  form,
  vertical = false,
  onDuplicating,
  className,
}: {
  form: FormListItem;
  vertical?: boolean;
  onDuplicating?: (pending: boolean) => void;
  className?: string;
}) {
  const router = useRouter();
  const canEdit = useContext(CanEditContext);
  const folders = useContext(FoldersContext);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(form.title);
  const [pending, startTransition] = useTransition();

  function copyLink() {
    const url = `${window.location.origin}/f/${form.slug}`;
    navigator.clipboard.writeText(url).then(
      () => toast.success("Link copied.", { description: "Paste it anywhere to share." }),
      () =>
        toast.error("Couldn't copy the link.", {
          description: "Your browser blocked the clipboard.",
          duration: 8000,
        }),
    );
  }

  function rename() {
    startTransition(async () => {
      const result = await renameFormAction(form.id, newTitle);
      if (result.ok) {
        setRenaming(false);
        toast.success("Renamed.");
        router.refresh();
      } else {
        toast.error(result.message, { duration: 8000 });
      }
    });
  }

  function togglePublished() {
    startTransition(async () => {
      if (form.publishState === "live") {
        const result = await unpublishAction(form.id);
        if (result.ok) toast("Unpublished.", { description: "The public link is off." });
        else toast.error(result.message, { duration: 8000 });
      } else {
        const result = await publishAction(form.id);
        if (result.ok) toast.success("Published.", { description: "Your form is live." });
        else
          toast.error("Couldn't publish.", {
            description: result.message,
            duration: 8000,
          });
      }
      router.refresh();
    });
  }

  function duplicate() {
    onDuplicating?.(true);
    startTransition(async () => {
      const result = await duplicateFormAction(form.id);
      onDuplicating?.(false);
      if (result.ok) {
        toast.success("Duplicated.", {
          description: `“${form.title} (copy)” is in your drafts.`,
          action: { label: "Open", onClick: () => router.push(`/forms/${result.id}`) },
        });
        router.refresh();
      } else {
        toast.error("Couldn't duplicate.", {
          description: "Check your connection and try again.",
          duration: 8000,
          action: { label: "Retry", onClick: duplicate },
        });
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteFormAction(form.id);
      if (result.ok) {
        setConfirmDelete(false);
        toast.success("Form deleted.", { description: `“${form.title}” is gone.` });
        router.refresh();
      } else {
        toast.error("Couldn't delete.", {
          description: "Nothing was removed. Try again.",
          duration: 8000,
        });
      }
    });
  }

  const Icon = vertical ? EllipsisVertical : Ellipsis;
  const responses =
    form.responseCount === 1
      ? "1 response"
      : `${form.responseCount.toLocaleString()} responses`;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Actions for "${form.title}"`}
            disabled={pending}
            className={cn(
              "fc-focus hover:bg-hover-wash aria-expanded:bg-hover-wash-strong relative z-10 grid size-8 shrink-0 place-items-center rounded-sm disabled:opacity-50",
              vertical && "size-11",
              className,
            )}
          >
            <Icon className="size-[18px]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[200px]">
          {canEdit && (
            <DropdownMenuItem asChild>
              <Link href={`/forms/${form.id}`}>
                <PencilLine /> Edit
              </Link>
            </DropdownMenuItem>
          )}
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
          {canEdit && (
            <DropdownMenuItem asChild>
              <Link href={`/forms/${form.id}?preview=1`}>
                <Eye /> Preview
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link href={`/forms/${form.id}/share`}>
              <Send /> Share
            </Link>
          </DropdownMenuItem>
          {canEdit && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  setNewTitle(form.title);
                  setRenaming(true);
                }}
              >
                <TextCursorInput /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={duplicate}>
                <Copy /> Duplicate
              </DropdownMenuItem>
              {folders.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <FolderInput /> Move to folder
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {[{ id: null, name: "No folder" }, ...folders].map((f) => (
                      <DropdownMenuItem
                        key={f.id ?? "none"}
                        disabled={(form.folderId ?? null) === f.id}
                        onSelect={async () => {
                          const result = await moveFormToFolderAction(form.id, f.id);
                          if (result.ok) {
                            toast.success(
                              f.id ? `Moved to ${f.name}.` : "Moved out of its folder.",
                            );
                            router.refresh();
                          } else {
                            toast.error(result.message);
                          }
                        }}
                      >
                        {f.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
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
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setConfirmDelete(true)}
              >
                <Trash2 /> Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

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
            <DialogFooter className="mt-5">
              <Button type="button" variant="outline" onClick={() => setRenaming(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={pending || !newTitle.trim()}
                data-loading={pending || undefined}
              >
                {pending && <ButtonSpinner />}
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete &ldquo;{form.title}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              The form
              {form.responseCount > 0 ? ` and its ${responses}` : ""} disappear
              {form.responseCount > 0 ? "" : "s"} from your dashboard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {form.hasPublishedVersion && (
            <div className="flex gap-2.5 rounded-sm border-[1.5px] border-[var(--alert-error-border)] bg-[var(--alert-error-bg)] px-3 py-2.5 text-[13.5px] leading-[1.45] text-[var(--alert-error-fg)]">
              <Link2Off className="mt-px size-4 shrink-0" />
              <span>This form is live. Its public link stops working immediately.</span>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              data-loading={pending || undefined}
              onClick={(e) => {
                e.preventDefault();
                remove();
              }}
            >
              {pending && <ButtonSpinner />}
              {pending ? "Deleting…" : "Delete form"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
