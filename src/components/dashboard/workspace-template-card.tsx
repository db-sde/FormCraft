"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Lock, PencilLine, Search, Trash2, Users } from "lucide-react";
import { toast } from "@/lib/toast";
import type { WorkspaceTemplateCard as Card } from "@/domains/templates";
import {
  createFormFromWorkspaceTemplateAction,
  deleteWorkspaceTemplateAction,
  duplicateWorkspaceTemplateAction,
  updateWorkspaceTemplateAction,
} from "@/app/(dashboard)/actions";
import { FormPreviewArt } from "@/components/forms/form-preview-art";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Button, ButtonSpinner } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * A workspace's own templates (F-61), searchable and filtered by
 * category. Anyone who can edit uses or copies one; its creator renames,
 * shares or hides it; its creator or an admin deletes it.
 */
export function WorkspaceTemplates({
  templates,
  canEdit,
  canAdmin,
}: {
  templates: Card[];
  canEdit: boolean;
  canAdmin: boolean;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const categories = [...new Set(templates.map((t) => t.category))].sort();
  const needle = query.trim().toLowerCase();
  const shown = templates.filter(
    (t) =>
      (category === "all" || t.category === category) &&
      (!needle ||
        t.title.toLowerCase().includes(needle) ||
        (t.description ?? "").toLowerCase().includes(needle)),
  );
  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="border-input bg-card focus-within:border-ink flex h-9 min-w-56 flex-1 items-center gap-2 rounded-sm border-[1.5px] px-2.5 sm:max-w-80">
          <Search className="text-muted-foreground size-4 shrink-0" aria-hidden />
          <input
            type="search"
            aria-label="Search your templates"
            placeholder="Search your templates"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        {categories.length > 1 && (
          <select
            aria-label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="border-input bg-card h-9 rounded-sm border-[1.5px] px-2 text-sm"
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">No templates match.</p>
      ) : (
        <div className="wide:grid-cols-4 grid gap-[22px] sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((template) => (
            <WorkspaceTemplateCard
              key={template.id}
              template={template}
              canEdit={canEdit}
              canAdmin={canAdmin}
            />
          ))}
        </div>
      )}
    </>
  );
}

export function WorkspaceTemplateCard({
  template,
  canEdit,
  canAdmin,
}: {
  template: Card;
  canEdit: boolean;
  canAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(template.title);
  const [category, setCategory] = useState(template.category);
  const shared = template.visibility === "workspace";

  function toggleShared() {
    start(async () => {
      const result = await updateWorkspaceTemplateAction(template.id, {
        visibility: shared ? "private" : "workspace",
      });
      if (result.ok) {
        toast.success(shared ? "Only you can see it now." : "Shared with the workspace.");
        router.refresh();
      } else toast.error(result.message, { duration: 8000 });
    });
  }
  function saveDetails() {
    start(async () => {
      const result = await updateWorkspaceTemplateAction(template.id, {
        title,
        category,
      });
      if (result.ok) {
        setRenaming(false);
        toast.success("Template updated.");
        router.refresh();
      } else toast.error(result.message, { duration: 8000 });
    });
  }
  function duplicate() {
    start(async () => {
      const result = await duplicateWorkspaceTemplateAction(template.id);
      if (result.ok) {
        toast.success("Copied.", { description: "The copy is private to you." });
        router.refresh();
      } else toast.error(result.message, { duration: 8000 });
    });
  }
  function remove() {
    if (
      !window.confirm(`Delete the template “${template.title}”? Forms made from it stay.`)
    )
      return;
    start(async () => {
      const result = await deleteWorkspaceTemplateAction(template.id);
      if (result.ok) {
        toast.success("Template deleted.");
        router.refresh();
      } else toast.error(result.message, { duration: 8000 });
    });
  }

  return (
    <div
      data-testid="workspace-template"
      className="border-ink bg-card flex flex-col overflow-hidden rounded-lg border-[1.5px]"
    >
      <FormPreviewArt
        preview={template.preview}
        progress={false}
        className="border-ink h-[136px] border-b-[1.5px]"
      />
      <div className="flex flex-1 flex-col gap-1.5 p-[18px]">
        <h3 className="font-heading text-[17px] leading-[1.3] font-bold">
          {template.title}
        </h3>
        <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-[12.5px]">
          {shared ? <Users className="size-3.5" /> : <Lock className="size-3.5" />}
          {shared ? "Workspace" : "Only you"}
          {" · "}
          {template.category}
          {template.createdByName && !template.mine
            ? ` · by ${template.createdByName}`
            : ""}
          {" · "}
          {template.questionCount} question{template.questionCount === 1 ? "" : "s"}
        </p>
        {canEdit && (
          <form
            action={createFormFromWorkspaceTemplateAction.bind(null, template.id)}
            className="mt-2.5"
          >
            <SubmitButton
              variant="outline"
              className="data-[loading=true]:bg-primary w-full font-semibold"
              pendingLabel="Creating form…"
            >
              Use this template
            </SubmitButton>
          </form>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
          {template.mine && (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setTitle(template.title);
                  setCategory(template.category);
                  setRenaming(true);
                }}
                aria-label={`Rename template “${template.title}”`}
                className="flex items-center gap-1 font-semibold underline-offset-2 hover:underline disabled:opacity-50"
              >
                <PencilLine className="size-3.5" /> Rename
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={toggleShared}
                className="font-semibold underline-offset-2 hover:underline disabled:opacity-50"
              >
                {shared ? "Make private" : "Share with workspace"}
              </button>
            </>
          )}
          {canEdit && (
            <button
              type="button"
              disabled={pending}
              onClick={duplicate}
              aria-label={`Duplicate template “${template.title}”`}
              className="flex items-center gap-1 font-semibold underline-offset-2 hover:underline disabled:opacity-50"
            >
              <Copy className="size-3.5" /> Duplicate
            </button>
          )}
          {(template.mine || canAdmin) && (
            <button
              type="button"
              disabled={pending}
              onClick={remove}
              aria-label={`Delete template “${template.title}”`}
              className="text-destructive ml-auto flex items-center gap-1 font-semibold disabled:opacity-50"
            >
              <Trash2 className="size-3.5" /> Delete
            </button>
          )}
        </div>
      </div>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Template details</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              saveDetails();
            }}
          >
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Name
              <Input
                value={title}
                maxLength={120}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Category
              <Input
                value={category}
                maxLength={40}
                onChange={(e) => setCategory(e.target.value)}
              />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenaming(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !title.trim()}>
                {pending && <ButtonSpinner />}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
