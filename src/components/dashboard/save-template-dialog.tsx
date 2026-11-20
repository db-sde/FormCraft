"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast";
import { saveFormAsTemplateAction } from "@/app/(dashboard)/actions";
import { Input } from "@/components/ui/input";
import { Button, ButtonSpinner } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** "Save as template" (F-61), from the dashboard's form menu and the
 * builder's (QA FC11-11). Saves the form's current draft. */
export function SaveTemplateDialog({
  formId,
  formTitle,
  open,
  onOpenChange,
}: {
  formId: string;
  formTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save as template</DialogTitle>
        </DialogHeader>
        {/* Mounted only while open, so each opening starts fresh. */}
        <TemplateForm
          formId={formId}
          formTitle={formTitle}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function TemplateForm({
  formId,
  formTitle,
  onDone,
}: {
  formId: string;
  formTitle: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(formTitle);
  const [category, setCategory] = useState("");
  const [shared, setShared] = useState(true);

  function save() {
    start(async () => {
      const result = await saveFormAsTemplateAction(formId, {
        title: name,
        category,
        visibility: shared ? "workspace" : "private",
      });
      if (result.ok) {
        onDone();
        toast.success("Saved as a template.", {
          description: shared
            ? "Everyone in the workspace can start a form from it."
            : "Only you can see it.",
          action: { label: "View", onClick: () => router.push("/templates") },
        });
      } else {
        toast.error(result.message, { duration: 8000 });
      }
    });
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <p className="text-muted-foreground text-sm">
        Copies the questions, logic and design as they are in the draft. Never the
        responses, integrations, payment settings or keys. Later changes to this form
        don&apos;t change the template.
      </p>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Template name
        <Input
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Category
        <Input
          value={category}
          maxLength={40}
          placeholder="Custom"
          onChange={(e) => setCategory(e.target.value)}
        />
      </label>
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-semibold">Who can use it</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="template-visibility"
            checked={shared}
            onChange={() => setShared(true)}
          />
          Everyone in this workspace
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="template-visibility"
            checked={!shared}
            onChange={() => setShared(false)}
          />
          Only me
        </label>
      </fieldset>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={pending || !name.trim()}
          data-loading={pending || undefined}
        >
          {pending && <ButtonSpinner />}
          {pending ? "Saving…" : "Save template"}
        </Button>
      </DialogFooter>
    </form>
  );
}
