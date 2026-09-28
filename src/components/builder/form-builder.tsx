"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, X, Palette, GitBranch } from "lucide-react";
import type {
  FormSchemaV1,
  QuestionV1,
  EndingV1,
  ThemeV1,
  LogicRuleV1,
} from "@/domains/forms/schema/v1";
import type { QuestionType } from "@/domains/forms/schema/question-types";
import {
  createQuestion,
  insertQuestion,
  removeQuestion,
  duplicateQuestion as duplicateQuestionAt,
  moveQuestion as moveQuestionAt,
  createEnding,
  canDeleteEnding,
  removeEnding,
  rulesReferencingQuestion,
  rulesReferencingEnding,
} from "@/domains/forms/builder";
import { toast } from "sonner";
import type { SaveDraftResult, PublishResult } from "@/app/(builder)/forms/[id]/actions";
import { QuestionList } from "./question-list";
import { AddQuestionMenu } from "./add-question-menu";
import { QuestionEditor } from "./question-editor";
import { SettingsPanel } from "./settings-panel";
import { EndingEditor, EndingSettingsPanel } from "./ending-editor";
import { ThemePreview } from "./theme-preview";
import { ThemeSettingsPanel } from "./theme-settings-panel";
import { LogicEditor } from "./logic-editor";
import { PreviewDialog } from "./preview-dialog";
import { SaveStatus, type SaveState } from "./save-status";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import { cn } from "cn";

type Selection =
  | { kind: "question"; id: string }
  | { kind: "ending"; id: string }
  | { kind: "theme" }
  | { kind: "logic" };

const AUTOSAVE_DEBOUNCE_MS = 800;

export type PublishInfo = {
  isPublished: boolean;
  publishedAt: string | null;
  publishedVersionNumber: number | null;
};

export function FormBuilder({
  formTitle,
  workspaceId,
  formId,
  slug,
  appUrl,
  draftVersionId,
  initialRevision,
  initialSchema,
  initialPublishInfo,
  onSave,
  onPublish,
  onUnpublish,
}: {
  formTitle: string;
  workspaceId: string;
  formId: string;
  slug: string;
  appUrl: string;
  draftVersionId: string;
  initialRevision: number;
  initialSchema: FormSchemaV1;
  initialPublishInfo: PublishInfo;
  onSave: (
    draftVersionId: string,
    expectedRevision: number,
    schema: FormSchemaV1,
  ) => Promise<SaveDraftResult>;
  onPublish: (formId: string) => Promise<PublishResult>;
  onUnpublish: (formId: string) => Promise<{ ok: true } | { ok: false; message: string }>;
}) {
  const [schema, setSchema] = useState(initialSchema);
  const [publishInfo, setPublishInfo] = useState(initialPublishInfo);
  const [publishing, setPublishing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selection, setSelection] = useState<Selection>({
    kind: "question",
    id: initialSchema.questions[0]?.id,
  });
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [pendingDelete, setPendingDelete] = useState<
    | { kind: "question"; id: string; label: string; affectedRules: LogicRuleV1[] }
    | { kind: "ending"; id: string; label: string; affectedRules: LogicRuleV1[] }
    | null
  >(null);

  const revisionRef = useRef(initialRevision);
  const savedSchemaRef = useRef(initialSchema);
  const latestSchemaRef = useRef(initialSchema);
  const isSavingRef = useRef(false);
  const needsResaveRef = useRef(false);
  const staleRef = useRef(false);

  latestSchemaRef.current = schema;

  async function performSave(schemaToSave: FormSchemaV1) {
    if (staleRef.current) return;
    if (isSavingRef.current) {
      needsResaveRef.current = true;
      return;
    }
    isSavingRef.current = true;
    setSaveState("saving");

    const result = await onSave(draftVersionId, revisionRef.current, schemaToSave);

    if (result.ok) {
      revisionRef.current = result.revision;
      savedSchemaRef.current = schemaToSave;
      setSaveState("saved");
    } else if (result.code === "stale") {
      staleRef.current = true;
      setSaveState("stale");
    } else {
      setSaveState("error");
    }

    isSavingRef.current = false;
    if (needsResaveRef.current) {
      needsResaveRef.current = false;
      void performSave(latestSchemaRef.current);
    }
  }

  useEffect(() => {
    if (schema === savedSchemaRef.current || staleRef.current) return;
    const timer = setTimeout(() => void performSave(schema), AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema]);

  function updateQuestion(next: QuestionV1) {
    setSchema((s) => ({
      ...s,
      questions: s.questions.map((q) => (q.id === next.id ? next : q)),
    }));
  }

  function updateEnding(next: EndingV1) {
    setSchema((s) => ({
      ...s,
      endings: s.endings.map((e) => (e.id === next.id ? next : e)),
    }));
  }

  function updateTheme(next: ThemeV1) {
    setSchema((s) => ({ ...s, theme: next }));
  }

  function updateLogic(next: LogicRuleV1[]) {
    setSchema((s) => ({ ...s, logic: next }));
  }

  function handleAdd(type: QuestionType) {
    const question = createQuestion(type, schema.questions.length);
    setSchema((s) => ({
      ...s,
      questions: insertQuestion(s.questions, question, s.questions.length),
    }));
    setSelection({ kind: "question", id: question.id });
  }

  function requestDeleteQuestion(id: string) {
    const question = schema.questions.find((q) => q.id === id);
    if (!question) return;
    const affectedRules = rulesReferencingQuestion(schema.logic, id);
    if (affectedRules.length > 0) {
      setPendingDelete({ kind: "question", id, label: question.label, affectedRules });
      return;
    }
    commitDeleteQuestion(id);
  }

  function commitDeleteQuestion(id: string) {
    setSchema((s) => ({
      ...s,
      questions: removeQuestion(s.questions, id),
      logic: s.logic.filter((r) => rulesReferencingQuestion([r], id).length === 0),
    }));
    if (selection.kind === "question" && selection.id === id) {
      const remaining = removeQuestion(schema.questions, id);
      setSelection(
        remaining.length > 0
          ? { kind: "question", id: remaining[0].id }
          : { kind: "ending", id: schema.endings[0].id },
      );
    }
  }

  function requestDeleteEnding(id: string) {
    if (!canDeleteEnding(schema.endings, id)) return;
    const ending = schema.endings.find((e) => e.id === id);
    if (!ending) return;
    const affectedRules = rulesReferencingEnding(schema.logic, id);
    if (affectedRules.length > 0) {
      setPendingDelete({ kind: "ending", id, label: ending.title, affectedRules });
      return;
    }
    commitDeleteEnding(id);
  }

  function commitDeleteEnding(id: string) {
    setSchema((s) => ({
      ...s,
      endings: removeEnding(s.endings, id),
      logic: s.logic.filter((r) => rulesReferencingEnding([r], id).length === 0),
    }));
    if (selection.kind === "ending" && selection.id === id) {
      const remaining =
        schema.endings.find((e) => e.isDefault && e.id !== id) ?? schema.endings[0];
      setSelection({ kind: "ending", id: remaining.id });
    }
  }

  function confirmPendingDelete() {
    if (!pendingDelete) return;
    if (pendingDelete.kind === "question") commitDeleteQuestion(pendingDelete.id);
    else commitDeleteEnding(pendingDelete.id);
    setPendingDelete(null);
  }

  function handleAddEnding() {
    const ending = createEnding(`Ending ${schema.endings.length + 1}`);
    setSchema((s) => ({ ...s, endings: [...s.endings, ending] }));
    setSelection({ kind: "ending", id: ending.id });
  }

  function handleDuplicate(id: string) {
    setSchema((s) => {
      const questions = duplicateQuestionAt(s.questions, id);
      const original = s.questions.findIndex((q) => q.id === id);
      const copy = questions[original + 1];
      if (copy) setSelection({ kind: "question", id: copy.id });
      return { ...s, questions };
    });
  }

  function handleMove(id: string, direction: "up" | "down") {
    setSchema((s) => ({ ...s, questions: moveQuestionAt(s.questions, id, direction) }));
  }

  const liveUrl = `${appUrl}/f/${slug}`;

  async function handlePublish() {
    setPublishing(true);
    const result = await onPublish(formId);
    setPublishing(false);

    if (result.ok) {
      setPublishInfo({
        isPublished: true,
        publishedAt: new Date().toISOString(),
        publishedVersionNumber: result.publishedVersionNumber,
      });
      toast.success(publishInfo.isPublished ? "Republished" : "Published", {
        description: "Your form is live.",
        action: { label: "View live", onClick: () => window.open(liveUrl, "_blank") },
      });
    } else {
      toast.error("Couldn't publish", { description: result.message });
    }
  }

  async function handleUnpublish() {
    setPublishing(true);
    const result = await onUnpublish(formId);
    setPublishing(false);

    if (result.ok) {
      setPublishInfo((p) => ({ ...p, isPublished: false }));
      toast("Unpublished", { description: "Your form is no longer live." });
    } else {
      toast.error("Couldn't unpublish", { description: result.message });
    }
  }

  const selectedQuestion =
    selection.kind === "question"
      ? schema.questions.find((q) => q.id === selection.id)
      : undefined;
  const selectedEnding =
    selection.kind === "ending"
      ? schema.endings.find((e) => e.id === selection.id)
      : undefined;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild variant="ghost" size="icon" aria-label="Back to dashboard">
            <Link href="/dashboard">
              <ArrowLeft />
            </Link>
          </Button>
          <span className="truncate font-medium">{formTitle}</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/forms/${formId}/responses`}
            className="text-muted-foreground hover:text-foreground text-sm underline-offset-2 hover:underline"
          >
            Responses
          </Link>
          <Separator orientation="vertical" className="h-5" />
          <SaveStatus state={saveState} />
          {saveState === "stale" && (
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
              Reload
            </Button>
          )}
          <Separator orientation="vertical" className="h-5" />
          {publishInfo.isPublished && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href={liveUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground text-sm underline"
                  >
                    View live
                  </a>
                </TooltipTrigger>
                <TooltipContent>{liveUrl}</TooltipContent>
              </Tooltip>
              <Button
                size="sm"
                variant="ghost"
                disabled={publishing}
                onClick={handleUnpublish}
              >
                Unpublish
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" onClick={() => setPreviewOpen(true)}>
            Preview
          </Button>
          <Button size="sm" disabled={publishing} onClick={handlePublish}>
            {publishing
              ? "Publishing…"
              : publishInfo.isPublished
                ? "Republish"
                : "Publish"}
          </Button>
        </div>
      </header>

      <PreviewDialog schema={schema} open={previewOpen} onOpenChange={setPreviewOpen} />

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-r p-3">
          <div>
            <p className="text-muted-foreground mb-2 px-1 text-xs font-medium tracking-wide uppercase">
              Questions
            </p>
            <QuestionList
              questions={schema.questions}
              selectedId={selection.kind === "question" ? selection.id : null}
              onSelect={(id) => setSelection({ kind: "question", id })}
              onMove={handleMove}
              onDuplicate={handleDuplicate}
              onDelete={requestDeleteQuestion}
            />
          </div>
          <AddQuestionMenu onAdd={handleAdd} />

          <Separator />

          <div>
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Endings
              </p>
              <button
                type="button"
                onClick={handleAddEnding}
                aria-label="Add ending"
                className="text-muted-foreground hover:text-foreground"
              >
                <Plus className="size-3.5" />
              </button>
            </div>
            <ol className="flex flex-col gap-1">
              {schema.endings.map((ending) => (
                <li key={ending.id} className="group flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSelection({ kind: "ending", id: ending.id })}
                    className={cn(
                      "min-w-0 flex-1 truncate rounded-md border px-2 py-1.5 text-left text-sm",
                      selection.kind === "ending" && selection.id === ending.id
                        ? "border-foreground/20 bg-accent"
                        : "hover:bg-accent/50 border-transparent",
                    )}
                  >
                    {ending.title || "Ending"}
                    {ending.isDefault && (
                      <span className="text-muted-foreground ml-1 text-xs">
                        (default)
                      </span>
                    )}
                  </button>
                  {canDeleteEnding(schema.endings, ending.id) && (
                    <button
                      type="button"
                      onClick={() => requestDeleteEnding(ending.id)}
                      aria-label={`Delete ending "${ending.title}"`}
                      className="text-muted-foreground hover:text-destructive shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </div>

          <Separator />

          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setSelection({ kind: "theme" })}
              className={cn(
                "flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm",
                selection.kind === "theme"
                  ? "border-foreground/20 bg-accent"
                  : "hover:bg-accent/50 border-transparent",
              )}
            >
              <Palette className="text-muted-foreground size-4" />
              Theme
            </button>
            <button
              type="button"
              onClick={() => setSelection({ kind: "logic" })}
              className={cn(
                "flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm",
                selection.kind === "logic"
                  ? "border-foreground/20 bg-accent"
                  : "hover:bg-accent/50 border-transparent",
              )}
            >
              <GitBranch className="text-muted-foreground size-4" />
              Logic
              {schema.logic.length > 0 && (
                <span className="text-muted-foreground ml-auto text-xs">
                  {schema.logic.length}
                </span>
              )}
            </button>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto px-10 py-12">
          {selectedQuestion && (
            <QuestionEditor question={selectedQuestion} onChange={updateQuestion} />
          )}
          {selectedEnding && (
            <EndingEditor ending={selectedEnding} onChange={updateEnding} />
          )}
          {selection.kind === "theme" && (
            <ThemePreview
              theme={schema.theme}
              formTitle={schema.meta.title || formTitle}
            />
          )}
          {selection.kind === "logic" && (
            <LogicEditor
              questions={schema.questions}
              endings={schema.endings}
              logic={schema.logic}
              onChange={updateLogic}
            />
          )}
        </main>

        <aside className="w-80 shrink-0 overflow-y-auto border-l p-4">
          {selectedQuestion && (
            <SettingsPanel question={selectedQuestion} onChange={updateQuestion} />
          )}
          {selectedEnding && (
            <EndingSettingsPanel ending={selectedEnding} onChange={updateEnding} />
          )}
          {selection.kind === "theme" && (
            <ThemeSettingsPanel
              theme={schema.theme}
              workspaceId={workspaceId}
              formId={formId}
              onChange={updateTheme}
            />
          )}
        </aside>
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete &quot;{pendingDelete?.label}&quot;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.affectedRules.length === 1
                ? "1 logic rule references this and will also be deleted."
                : `${pendingDelete?.affectedRules.length ?? 0} logic rules reference this and will also be deleted.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPendingDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
