"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Plus,
  X,
  Palette,
  GitBranch,
  Eye,
  EyeOff,
  MoreHorizontal,
  CircleAlert,
  Contact,
  Loader2,
  RefreshCw,
  Rocket,
  Send,
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
  hasLeadCapture,
  insertLeadCapture,
  convertQuestion,
  rulesBrokenByTypeChange,
  rulesBrokenByOptionRemoval,
  rulesBrokenByReorder,
} from "@/domains/forms/builder";
import {
  describeSchemaProblem,
  type SchemaProblem,
} from "@/domains/forms/schema/validate";
import { toast } from "sonner";
import {
  trackBuilderEventAction,
  type SaveDraftResult,
  type PublishResult,
} from "@/app/(form)/forms/[id]/actions";
import { QuestionList } from "./question-list";
import { QUESTION_TYPE_META } from "./question-meta";
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
import { FormTopBar } from "@/components/forms/form-top-bar";
import { CopyLinkButton, OpenLiveButton } from "@/components/forms/live-link-actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
  addLeadCaptureOnOpen = false,
  openPreviewOnLoad = false,
}: {
  /** Opened from a dashboard "Preview" (`?preview=1`). */
  openPreviewOnLoad?: boolean;
  /** Opened from "Add lead capture" elsewhere (`?leadCapture=1`). */
  addLeadCaptureOnOpen?: boolean;
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
  // Arriving via "Add lead capture" inserts the block straight away (it
  // autosaves like any other edit) and selects it.
  const [opening] = useState(() => {
    if (addLeadCaptureOnOpen && !hasLeadCapture(initialSchema.questions)) {
      const { questions, id } = insertLeadCapture(initialSchema.questions);
      return { schema: { ...initialSchema, questions }, selectedId: id, added: true };
    }
    return {
      schema: initialSchema,
      selectedId: initialSchema.questions[0]?.id,
      added: false,
    };
  });
  const [schema, setSchema] = useState(opening.schema);
  const [publishInfo, setPublishInfo] = useState(initialPublishInfo);
  const [publishing, setPublishing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(openPreviewOnLoad);
  const [liveDialogOpen, setLiveDialogOpen] = useState(false);
  const [pendingTypeChange, setPendingTypeChange] = useState<{
    question: QuestionV1;
    to: QuestionType;
    lossy: boolean;
    brokenRules: LogicRuleV1[];
  } | null>(null);
  const [selection, setSelection] = useState<Selection>({
    kind: "question",
    id: opening.selectedId,
  });
  const router = useRouter();
  const announcedLeadCaptureRef = useRef(false);

  useEffect(() => {
    if (!opening.added || announcedLeadCaptureRef.current) return;
    announcedLeadCaptureRef.current = true;
    toast.success("Lead capture added", {
      description: "It sits before your last question — adjust the fields on the right.",
    });
    router.replace(`/forms/${formId}`);
  }, [opening.added, router, formId]);
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

  // Leaving with edits that haven't reached the server — still in the
  // autosave debounce, mid-save, failing, or invalid — must not be
  // silent (PRD §3.2). Closing/reloading the tab gets the browser's
  // "leave site?" prompt; navigating within the app flushes the save
  // on the way out instead.
  useEffect(() => {
    const unsaved = () =>
      !staleRef.current &&
      (isSavingRef.current || latestSchemaRef.current !== savedSchemaRef.current);
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!unsaved()) return;
      event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (unsaved()) void performSaveRef.current(latestSchemaRef.current);
    };
  }, []);

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

  const performSaveRef = useRef(performSave);
  useEffect(() => {
    performSaveRef.current = performSave;
  });

  useEffect(() => {
    if (schema === savedSchemaRef.current || staleRef.current) return;
    const timer = setTimeout(() => void performSave(schema), AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema]);

  function updateQuestion(next: QuestionV1) {
    // Deleting an option a logic rule checks would leave the rule
    // pointing at nothing, so those rules go with it (and we say so).
    const remaining = (next.settings as { options?: { id: string }[] }).options;
    const removed = remaining
      ? rulesBrokenByOptionRemoval(
          schema.logic,
          next.id,
          new Set(remaining.map((o) => o.id)),
        )
      : [];
    if (removed.length > 0) {
      const gone = new Set(removed.map((r) => r.id));
      toast(
        removed.length === 1
          ? "1 logic rule removed"
          : `${removed.length} logic rules removed`,
        { description: "They checked an option you just deleted." },
      );
      setSchema((s) => ({
        ...s,
        questions: s.questions.map((q) => (q.id === next.id ? next : q)),
        logic: s.logic.filter((r) => !gone.has(r.id)),
      }));
      return;
    }
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

  function track(eventType: "question_added" | "form_previewed", questionType?: string) {
    void trackBuilderEventAction(formId, eventType, questionType).catch(() => undefined);
  }

  function handleAdd(type: QuestionType) {
    track("question_added", type);
    const question = createQuestion(type, schema.questions.length);
    setSchema((s) => ({
      ...s,
      questions: insertQuestion(s.questions, question, s.questions.length),
    }));
    setSelection({ kind: "question", id: question.id });
  }

  function applyTypeChange(question: QuestionV1, to: QuestionType) {
    const converted = convertQuestion(question, to).question;
    const broken = new Set(
      rulesBrokenByTypeChange(schema.logic, question.id, question.type, to).map(
        (r) => r.id,
      ),
    );
    setSchema((s) => ({
      ...s,
      questions: s.questions.map((q) => (q.id === question.id ? converted : q)),
      logic: s.logic.filter((r) => !broken.has(r.id)),
    }));
  }

  function requestTypeChange(question: QuestionV1, to: QuestionType) {
    if (question.type === to) return;
    const { lossy } = convertQuestion(question, to);
    const brokenRules = rulesBrokenByTypeChange(
      schema.logic,
      question.id,
      question.type,
      to,
    );
    if (lossy || brokenRules.length > 0) {
      setPendingTypeChange({ question, to, lossy, brokenRules });
    } else {
      applyTypeChange(question, to);
    }
  }

  function handleAddLeadCapture() {
    track("question_added", "contact_info");
    const { questions, id } = insertLeadCapture(schema.questions);
    setSchema((s) => ({ ...s, questions }));
    setSelection({ kind: "question", id });
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
    const moved = moveQuestionAt(schema.questions, id, direction);
    // A rule may only jump forward. If this move would turn one into a
    // jump back, refuse rather than quietly rewriting the creator's logic.
    const broken = rulesBrokenByReorder(schema.logic, schema.questions, moved);
    if (broken.length > 0) {
      toast.error("Can't move it there", {
        description:
          "A logic rule would then jump back to an earlier question. Change that rule first.",
      });
      return;
    }
    setSchema((s) => ({ ...s, questions: moveQuestionAt(s.questions, id, direction) }));
  }

  const liveUrl = `${appUrl}/f/${slug}`;

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
      if (publishInfo.isPublished) {
        toast.success("Changes published", {
          description: "Respondents now see the latest version.",
        });
      } else {
        setLiveDialogOpen(true);
      }
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

  const publishLabel = publishing
    ? "Publishing…"
    : !publishInfo.isPublished
      ? "Publish"
      : publishInfo.hasUnpublishedChanges
        ? "Publish changes"
        : "Up to date";

  return (
    <div className="bg-canvas flex h-dvh flex-col">
      <FormTopBar
        formId={formId}
        active="build"
        title={
          <>
            <FormTitleInput
              title={formTitle}
              onRename={(title) => onRename(formId, title)}
              onTitleChange={(title) =>
                setSchema((s) => ({ ...s, meta: { ...s.meta, title } }))
              }
            />
            <div className="hidden shrink-0 items-center gap-2 sm:flex">
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
          </>
        }
        actions={
          <>
            {publishInfo.isPublished && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="hidden items-center px-1 sm:flex">
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          publishInfo.hasUnpublishedChanges
                            ? "bg-amber-500"
                            : "bg-emerald-500",
                        )}
                      />
                      <span className="sr-only">
                        {publishInfo.hasUnpublishedChanges
                          ? "Unpublished changes"
                          : "Live"}
                      </span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {publishInfo.hasUnpublishedChanges
                      ? "Live — but your latest edits aren't published yet."
                      : "Live — respondents see exactly what you're editing."}
                  </TooltipContent>
                </Tooltip>
                <CopyLinkButton slug={slug} />
                <OpenLiveButton slug={slug} />
              </>
            )}
            <Button
              variant="outline"
              onClick={() => {
                setPreviewOpen(true);
                track("form_previewed");
              }}
            >
              <Eye />
              <span className="hidden sm:inline">Preview</span>
            </Button>
            <Button
              variant={
                publishInfo.isPublished && !publishInfo.hasUnpublishedChanges
                  ? "outline"
                  : "default"
              }
              disabled={
                publishing ||
                (publishInfo.isPublished && !publishInfo.hasUnpublishedChanges)
              }
              onClick={handlePublish}
            >
              {publishing ? <Loader2 className="animate-spin" /> : <Rocket />}
              <span
                className={cn(
                  publishInfo.isPublished &&
                    !publishInfo.hasUnpublishedChanges &&
                    "sr-only sm:not-sr-only",
                )}
              >
                {publishLabel}
              </span>
            </Button>
            {publishInfo.isPublished && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="More publishing options"
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem asChild>
                    <Link href={`/forms/${formId}/share`}>
                      <Send /> Share options
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={publishing}
                    onSelect={() => void handlePublish()}
                  >
                    <RefreshCw /> Republish
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
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
          </>
        }
      />

      <Dialog open={liveDialogOpen} onOpenChange={setLiveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>🎉 Your form is live</DialogTitle>
            <DialogDescription>
              Anyone with this link can fill it in. Keep editing any time — changes go
              live when you publish them.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-muted/60 truncate rounded-md border px-3 py-2 font-mono text-sm">
            {appUrl ? liveUrl : `/f/${slug}`}
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button asChild variant="ghost">
              <Link href={`/forms/${formId}/share`}>More ways to share</Link>
            </Button>
            <div className="flex gap-2">
              <OpenLiveButton slug={slug} label="Open" />
              <CopyLinkButton slug={slug} label="Copy link" variant="default" />
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PreviewDialog schema={schema} open={previewOpen} onOpenChange={setPreviewOpen} />

      {/* Three panes side by side from md up; stacked (and the whole page
          scrolls) on phones. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        <aside className="bg-background flex w-full shrink-0 flex-col gap-4 border-b p-3 md:w-72 md:overflow-y-auto md:border-r md:border-b-0">
          <div>
            <p className="text-muted-foreground mb-2 flex items-center justify-between px-1 text-xs font-semibold tracking-wide uppercase">
              Questions
              <span className="font-normal normal-case">
                {schema.questions.length} step{schema.questions.length === 1 ? "" : "s"}
              </span>
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

          {!hasLeadCapture(schema.questions) && (
            <div className="border-primary/25 bg-accent/60 rounded-lg border p-3">
              <p className="text-accent-foreground flex items-center gap-1.5 text-sm font-semibold">
                <Contact className="size-4" />
                Capture leads
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                Ask for name, email and phone before your last question. Details are saved
                the moment they&apos;re entered — even if the person never submits.
              </p>
              <Button size="sm" className="mt-2 w-full" onClick={handleAddLeadCapture}>
                <Plus /> Add lead capture
              </Button>
            </div>
          )}

          <Separator />

          <div>
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
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
              Design
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

        <main className="flex-1 px-4 py-8 sm:px-10 sm:py-12 md:overflow-y-auto">
          {selectedQuestion && (
            <QuestionEditor
              question={selectedQuestion}
              theme={schema.theme}
              onChange={updateQuestion}
            />
          )}
          {selectedEnding && (
            <EndingEditor
              ending={selectedEnding}
              theme={schema.theme}
              onChange={updateEnding}
            />
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
            "bg-background w-full shrink-0 border-t p-4 md:w-72 md:overflow-y-auto md:border-t-0 md:border-l lg:w-80",
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
            <SettingsPanel
              workspaceId={workspaceId}
              formId={formId}
              question={selectedQuestion}
              onChange={updateQuestion}
              onChangeType={(to) => requestTypeChange(selectedQuestion, to)}
            />
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
        open={pendingTypeChange !== null}
        onOpenChange={(open) => !open && setPendingTypeChange(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Change to{" "}
              {pendingTypeChange && QUESTION_TYPE_META[pendingTypeChange.to].label}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingTypeChange?.lossy &&
                "This question's settings (options, limits, validation) will reset. "}
              {pendingTypeChange &&
                pendingTypeChange.brokenRules.length > 0 &&
                `${pendingTypeChange.brokenRules.length} logic rule${pendingTypeChange.brokenRules.length === 1 ? "" : "s"} based on its answer will be removed. `}
              Responses you&apos;ve already collected keep their answers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingTypeChange) {
                  applyTypeChange(pendingTypeChange.question, pendingTypeChange.to);
                }
                setPendingTypeChange(null);
              }}
            >
              Change type
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
