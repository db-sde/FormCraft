"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Inbox, Link2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { FormListItem } from "@/domains/forms";
import { duplicateFormAction, deleteFormAction } from "@/app/(dashboard)/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

function formatUpdated(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function FormCard({ form }: { form: FormListItem }) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();

  function copyLink() {
    const url = `${window.location.origin}/f/${form.slug}`;
    navigator.clipboard.writeText(url).then(
      () => toast.success("Link copied", { description: url }),
      () => toast.error("Couldn't copy the link", { description: url }),
    );
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
      <Card className="hover:border-foreground/30 relative h-full transition-colors">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="min-w-0 text-base">
              {/* The whole card is clickable via this link's ::after
                  overlay, while the menu button below stays a separate,
                  real control (no button nested inside a link). */}
              <Link
                href={`/forms/${form.id}`}
                className="block truncate after:absolute after:inset-0 after:content-['']"
              >
                {form.title}
              </Link>
            </CardTitle>
            <div className="relative z-10 flex shrink-0 items-center gap-1">
              <Badge variant={form.hasPublishedVersion ? "default" : "secondary"}>
                {form.hasPublishedVersion ? "Live" : "Draft"}
              </Badge>
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
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link href={`/forms/${form.id}`}>
                      <Pencil /> Edit
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
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          {form.responseCount} response{form.responseCount === 1 ? "" : "s"} · Edited{" "}
          {formatUpdated(form.updatedAt)}
        </CardContent>
      </Card>

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
