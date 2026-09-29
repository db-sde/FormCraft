"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Plus,
  X,
  Palette,
  GitBranch,
  Link2,
  ExternalLink,
  Eye,
  EyeOff,
  MoreHorizontal,
  CircleAlert,
} from "lucide-react";
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
  canDeleteQuestion,
  duplicateQuestion as duplicateQuestionAt,
  moveQuestion as moveQuestionAt,
  createEnding,
  canDeleteEnding,
  removeEnding,
  rulesReferencingQuestion,
  rulesReferencingEnding,
} from "@/domains/forms/builder";
import {
  describeSchemaProblem,
  type SchemaProblem,
} from "@/domains/forms/schema/validate";
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
import { FormTitleInput } from "./form-title-input";
import { FormTabs } from "@/components/forms/form-tabs";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
const SAVE_RETRY_MS = 5000;

export type PublishInfo = {
  isPublished: boolean;
  publishedAt: string | null;
  publishedVersionNumber: number | null;
  hasUnpublishedChanges: boolean;
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
  onRename,
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
  onRename: (
    formId: string,
    title: string,
  ) => Promise<{ ok: true; title: string } | { ok: false; message: string }>;
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
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [saveProblem, setSaveProblem] = useState<SchemaProblem | null>(null);

  useEffect(() => () => clearTimeout(retryTimerRef.current), []);

  latestSchemaRef.current = schema;

  async function performSave(schemaToSave: FormSchemaV1) {
    if (staleRef.current) return;
    if (isSavingRef.current) {
      needsResaveRef.current = true;
      return;
    }
    clearTimeout(retryTimerRef.current);

    // An invalid draft (e.g. min > max) would only bounce off the server
    // with a structural error, so explain it here and wait for the next
    // edit instead of sending it.
    const problem = describeSchemaProblem(schemaToSave);
    if (problem) {
      setSaveProblem(problem);
      setSaveState("invalid");
      return;
    }
    setSaveProblem(null);

    isSavingRef.current = true;
    setSaveState("saving");

    let result: SaveDraftResult;
    try {
      result = await onSave(draftVersionId, revisionRef.current, schemaToSave);
    } catch {
      // Network failure / server action crash — treated as transient.
      result = { ok: false, code: "unknown", message: "Failed to save." };
    }

    if (result.ok) {
      revisionRef.current = result.revision;
      savedSchemaRef.current = schemaToSave;
      setSaveState("saved");
      setPublishInfo((p) => (p.isPublished ? { ...p, hasUnpublishedChanges: true } : p));
    } else if (result.code === "stale") {
      staleRef.current = true;
      setSaveState("stale");
    } else if (result.code === "invalid") {
      // The client check passed but the server disagreed — retrying the
      // same content can't help, so wait for the next edit.
      setSaveProblem({
        message: "Some settings are invalid. Check your recent changes.",
      });
      setSaveState("invalid");
    } else {
      setSaveState("error");
      retryTimerRef.current = setTimeout(() => {
        if (latestSchemaRef.current !== savedSchemaRef.current) {
          void performSave(latestSchemaRef.current);
        }
      }, SAVE_RETRY_MS);
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
    if (!question || !canDeleteQuestion(schema.questions, id)) return;
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
      if (questions === s.questions) return s; // e.g. the pinned welcome screen
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

  async function copyLiveLink() {
    // appUrl may be unset in some environments — fall back to the
    // origin the creator is actually on so the copied link is absolute.
    const absolute = appUrl ? liveUrl : `${window.location.origin}/f/${slug}`;
    try {
      await navigator.clipboard.writeText(absolute);
      toast.success("Link copied", { description: absolute });
    } catch {
      toast.error("Couldn't copy the link", { description: absolute });
    }
  }

  /** Publish reads the draft from the database, so any edit still
   * sitting in the autosave debounce (or mid-save) must land first —
   * otherwise "edit, then quickly Publish" publishes without the edit. */
  async function flushPendingSave(): Promise<boolean> {
    for (let i = 0; i < 100 && isSavingRef.current; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (latestSchemaRef.current !== savedSchemaRef.current) {
      await performSave(latestSchemaRef.current);
    }
    return !staleRef.current && latestSchemaRef.current === savedSchemaRef.current;
  }

  async function handlePublish() {
    setPublishing(true);
    if (!(await flushPendingSave())) {
      setPublishing(false);
      toast.error("Couldn't publish", {
        description:
          describeSchemaProblem(latestSchemaRef.current)?.message ??
          "Your latest changes haven't saved yet. Please try again in a moment.",
      });
      return;
    }
    const result = await onPublish(formId);
    setPublishing(false);

    if (result.ok) {
      setPublishInfo({
        isPublished: true,
        publishedAt: new Date().toISOString(),
        publishedVersionNumber: result.publishedVersionNumber,
        hasUnpublishedChanges: false,
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

  // Only the part after "Question 3: " — the alert already sits beside it.
  const selectedProblem =
    saveState === "invalid" &&
    saveProblem &&
    ((selectedQuestion && saveProblem.questionId === selectedQuestion.id) ||
      (selectedEnding && saveProblem.endingId === selectedEnding.id))
      ? saveProblem.message
          .replace(/^[^:]+:\s*/, "")
          .replace(/^./, (c) => c.toUpperCase())
      : null;

  function showProblem() {
    if (saveProblem?.questionId) {
      setSelection({ kind: "question", id: saveProblem.questionId });
    } else if (saveProblem?.endingId) {
      setSelection({ kind: "ending", id: saveProblem.endingId });
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="grid h-14 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b px-3">
        <div className="flex min-w-0 items-center gap-1">
          <Button asChild variant="ghost" size="icon" aria-label="Back to dashboard">
            <Link href="/dashboard">
              <ArrowLeft />
            </Link>
          </Button>
          <FormTitleInput
            title={formTitle}
            onRename={(title) => onRename(formId, title)}
            onTitleChange={(title) =>
              setSchema((s) => ({ ...s, meta: { ...s.meta, title } }))
            }
          />
          <div className="hidden shrink-0 items-center gap-2 lg:flex">
            <SaveStatus
              state={saveState}
              problem={saveProblem?.message}
              onProblemClick={showProblem}
            />
            {saveState === "stale" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.location.reload()}
              >
                Reload
              </Button>
            )}
          </div>
        </div>

        <FormTabs formId={formId} active="build" />

        <div className="flex min-w-0 items-center justify-end gap-2 overflow-x-auto [&>*]:shrink-0">
          {publishInfo.isPublished && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={cn(
                      "flex items-center gap-1.5 text-xs font-medium",
                      publishInfo.hasUnpublishedChanges
                        ? "text-amber-600"
                        : "text-emerald-600",
                    )}
                  >
                    <span
                      className={cn(
                        "size-2 rounded-full",
                        publishInfo.hasUnpublishedChanges
                          ? "bg-amber-500"
                          : "bg-emerald-500",
                      )}
                    />
                    <span className="hidden 2xl:inline">
                      {publishInfo.hasUnpublishedChanges ? "Unpublished changes" : "Live"}
                    </span>
                    <span className="sr-only 2xl:hidden">
                      {publishInfo.hasUnpublishedChanges ? "Unpublished changes" : "Live"}
                    </span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {publishInfo.hasUnpublishedChanges
                    ? "Respondents still see the last published version. Publish to update it."
                    : "Respondents see exactly what you're editing."}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Copy link"
                    onClick={() => void copyLiveLink()}
                  >
                    <Link2 />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy link</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    asChild
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Open live form"
                  >
                    <a href={liveUrl} target="_blank" rel="noreferrer">
                      <ExternalLink />
                    </a>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{liveUrl}</TooltipContent>
              </Tooltip>
            </>
          )}
          <Button size="sm" variant="outline" onClick={() => setPreviewOpen(true)}>
            <Eye /> Preview
          </Button>
          <Button
            size="sm"
            variant={
              publishInfo.isPublished && !publishInfo.hasUnpublishedChanges
                ? "outline"
                : "default"
            }
            disabled={publishing}
            onClick={handlePublish}
          >
            {publishing
              ? "Publishing…"
              : !publishInfo.isPublished
                ? "Publish"
                : publishInfo.hasUnpublishedChanges
                  ? "Publish changes"
                  : "Republish"}
          </Button>
          {publishInfo.isPublished && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="More publishing options"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  variant="destructive"
                  disabled={publishing}
                  onSelect={() => void handleUnpublish()}
                >
                  <EyeOff /> Unpublish
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
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
          <AddQuestionMenu
            onAdd={handleAdd}
            canAddWelcome={!schema.questions.some((q) => q.type === "welcome_screen")}
          />

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

        <aside
          className={cn(
            "w-80 shrink-0 overflow-y-auto border-l p-4",
            // The logic editor has no side settings; give it the room.
            selection.kind === "logic" && "hidden",
          )}
        >
          {selectedProblem && (
            <Alert variant="destructive" className="mb-4">
              <CircleAlert />
              <AlertTitle>Not saved</AlertTitle>
              <AlertDescription>{selectedProblem}</AlertDescription>
            </Alert>
          )}
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
