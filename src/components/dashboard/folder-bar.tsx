"use client";

import { useState, useTransition } from "react";
import { Folder, FolderPlus, MoreHorizontal } from "lucide-react";
import {
  createFolderAction,
  deleteFolderAction,
  renameFolderAction,
} from "@/app/(dashboard)/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/lib/toast";
import { cn } from "cn";

export type FolderFilter = "all" | "none" | string;

/** Folders above the forms (PRD P2.20): pick one to see its forms;
 * editors can add, rename and delete. Deleting never deletes forms. */
export function FolderBar({
  folders,
  counts,
  value,
  onChange,
  canEdit,
}: {
  folders: { id: string; name: string }[];
  /** Forms per folder id, plus "none" and "all". */
  counts: Record<string, number>;
  value: FolderFilter;
  onChange: (next: FolderFilter) => void;
  canEdit: boolean;
}) {
  const [pending, start] = useTransition();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  if (folders.length === 0 && !canEdit) return null;

  const chip = (key: FolderFilter, label: string, count: number) => (
    <button
      key={key}
      type="button"
      aria-pressed={value === key}
      onClick={() => onChange(key)}
      className={cn(
        "fc-focus flex h-8 items-center gap-1.5 rounded-sm border-[1.5px] px-2.5 text-[13px] font-semibold",
        value === key
          ? "border-ink bg-card"
          : "text-muted-foreground hover:text-foreground border-transparent",
      )}
    >
      {key !== "all" && <Folder className="size-3.5" aria-hidden />}
      {label}
      <span className="tabular-nums opacity-60">{count}</span>
    </button>
  );

  return (
    <nav aria-label="Folders" className="mb-4 flex flex-wrap items-center gap-1">
      {chip("all", "All folders", counts.all ?? 0)}
      {folders.map((folder) => (
        <span key={folder.id} className="group flex items-center">
          {chip(folder.id, folder.name, counts[folder.id] ?? 0)}
          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`${folder.name} folder options`}
                  className="fc-focus text-muted-foreground hover:text-foreground grid size-7 place-items-center rounded-sm opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 [@media(hover:none)]:opacity-100"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  onSelect={() => {
                    const next = window.prompt("Rename folder", folder.name);
                    if (!next || next === folder.name) return;
                    start(async () => {
                      const result = await renameFolderAction(folder.id, next);
                      if (!result.ok) toast.error(result.message);
                    });
                  }}
                >
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => {
                    const n = counts[folder.id] ?? 0;
                    const message =
                      n > 0
                        ? `Delete “${folder.name}”? Its ${n} form${n === 1 ? "" : "s"} won't be deleted; they'll move out of the folder.`
                        : `Delete “${folder.name}”?`;
                    if (!window.confirm(message)) return;
                    start(async () => {
                      const result = await deleteFolderAction(folder.id);
                      if (result.ok) {
                        if (value === folder.id) onChange("all");
                        toast.success("Folder deleted. Its forms are still here.");
                      } else {
                        toast.error(result.message);
                      }
                    });
                  }}
                >
                  Delete folder
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </span>
      ))}
      {folders.length > 0 && chip("none", "Not in a folder", counts.none ?? 0)}
      {canEdit &&
        (creating ? (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const result = await createFolderAction(name);
                if (result.ok) {
                  setName("");
                  setCreating(false);
                  if (result.folder) onChange(result.folder.id);
                } else {
                  toast.error(result.message);
                }
              });
            }}
          >
            <input
              autoFocus
              aria-label="New folder name"
              value={name}
              maxLength={80}
              placeholder="Folder name"
              onChange={(e) => setName(e.target.value)}
              onBlur={() => !name && setCreating(false)}
              className="border-input bg-field h-8 w-[160px] rounded-sm border-[1.5px] px-2 text-[13px]"
            />
            <button
              type="submit"
              disabled={pending || !name.trim()}
              className="fc-focus h-8 rounded-sm px-2.5 text-[13px] font-semibold"
            >
              Add
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="fc-focus text-muted-foreground hover:text-foreground flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-[13px] font-semibold"
          >
            <FolderPlus className="size-3.5" /> New folder
          </button>
        ))}
    </nav>
  );
}
