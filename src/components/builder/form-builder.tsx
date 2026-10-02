"use client";

import type { RuleProposal } from "@/domains/ai/rule-draft";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronRight,
  Contact,
  Ellipsis,
  Eye,
  EyeOff,
  Flag,
  GitBranch,
  Languages,
  Palette,
  Plus,
  Split,
  Trash2,
  X,
} from "lucide-react";
import type {
  FormSchemaV1,
  QuestionV1,
  EndingV1,
  ThemeV1,
} from "@/domains/forms/schema/v1";
import type { QuestionType } from "@/domains/forms/schema/question-types";
import {
  createQuestion,
  insertQuestion,
  removeQuestion,
  canDeleteQuestion,
  duplicateQuestion as duplicateQuestionAt,
  moveQuestion as moveQuestionAt,
  reorderQuestions,
  createEnding,
  canDeleteEnding,
  removeEnding,
  hasLeadCapture,
  insertLeadCapture,
  convertQuestion,
  rulesBrokenByTypeChange,
} from "@/domains/forms/builder";
import {
  describeSchemaProblem,
  type SchemaProblem,
} from "@/domains/forms/schema/validate";
import { toast } from "@/lib/toast";
import {
  trackBuilderEventAction,
  type SaveDraftResult,
  type PublishResult,
} from "@/app/(form)/forms/[id]/actions";
import { QuestionList } from "./question-list";
import { QUESTION_TYPE_META, TypeTile } from "./question-meta";
import { AddQuestionMenu } from "./add-question-menu";
import { SettingsPanel } from "./settings-panel";
import { EndingSettingsPanel } from "./ending-editor";
import { CHOICE_TYPES, syncCarriedOptions } from "@/domains/forms/options";
import { themeForPlan } from "@/domains/themes/fonts";
import { ThemeSettingsPanel } from "./theme-settings-panel";
import { LogicEditor } from "./logic-editor";
import { TranslationsEditor } from "./translations-editor";
import { QuestionLogicPanel } from "./logic/question-logic-panel";
import {
  describeRule,
  numberedQuestions,
  questionKind,
  questionName,
} from "./logic/logic-ui";
import {
  allRules,
  conditionUsesQuestion,
  endingReferences,
  jumpsBrokenByReorder,
  questionReferences,
  removeEndingReferences,
  removeQuestionReferences,
  removeRules,
  detachOptionsFrom,
  rulesBrokenByOptionChange,
} from "@/domains/forms/references";
import { PreviewDialog } from "./preview-dialog";
import { SaveStatus, type SaveState } from "./save-status";
import { FormTitleInput } from "./form-title-input";
import { BuilderCanvas } from "./builder-canvas";
import { NotSavedAlert, PanelHeader } from "./panel-ui";
import { FormTabs } from "@/components/forms/form-tabs";
import { SharePopover } from "@/components/forms/share-popover";
import { publicFormUrl } from "@/components/forms/live-link-actions";
import { useRouter } from "next/navigation";
import { Button, ButtonSpinner } from "@/components/ui/button";
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
  AlertDialogMedia,
} from "@/components/ui/alert-dialog";
import { cn } from "cn";

type Selection =
  | { kind: "question"; id: string }
  | { kind: "ending"; id: string }
  | { kind: "theme" }
  | { kind: "logic" }
  | { kind: "languages" };

const AUTOSAVE_DEBOUNCE_MS = 800;
const SAVE_RETRY_MS = 5000;

export type PublishInfo = {
  isPublished: boolean;
  publishedAt: string | null;
  publishedVersionNumber: number | null;
  hasUnpublishedChanges: boolean;
};

function deleteSummary(pending: {
  kind: "question" | "ending";
  ruleIds: string[];
  questionIds: string[];
}): string {
  const rules = pending.ruleIds.length;
  const ruleText = `${rules} logic rule${rules === 1 ? "" : "s"}`;
  if (pending.kind === "ending") {
    return `${ruleText} ${rules === 1 ? "goes" : "go"} to this ending. Deleting it also removes ${rules === 1 ? "that rule" : "those rules"}.`;
  }
  const parts = [
    rules > 0 ? ruleText : null,
    pending.questionIds.length > 0
      ? `${pending.questionIds.length} other question${pending.questionIds.length === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean);
  return `It's used by ${parts.join(" and ")}. Deleting the question also removes what depends on it.`;
}

export function FormBuilder({
  formTitle,
  workspaceId,
  formId,
  slug,
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
  aiEnabled = false,
  onProposeRule,
  brandingRemovable = true,
  customFonts = true,
  multilingual = true,
}: {
  /** The plan shows more than one language on the live form. */
  multilingual?: boolean;
  /** The plan allows switching off the "Made with FormCraft" badge. */
  brandingRemovable?: boolean;
  /** The plan includes paid and uploaded fonts. */
  customFonts?: boolean;
  /** AI is configured on the server ("Describe a rule"). */
  aiEnabled?: boolean;
  onProposeRule?: (
    formId: string,
    instruction: string,
    schema: FormSchemaV1,
  ) => Promise<{ ok: true; proposal: RuleProposal } | { ok: false; message: string }>;
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
  const [schema, setRawSchema] = useState(opening.schema);
  // Every edit goes through here, so carried-forward options always
  // match the question they come from (domains/forms/options.ts).
  const setSchema = useCallback(
    (update: FormSchemaV1 | ((current: FormSchemaV1) => FormSchemaV1)) =>
      setRawSchema((current) =>
        syncCarriedOptions(typeof update === "function" ? update(current) : update),
      ),
    [],
  );
  const [publishInfo, setPublishInfo] = useState(initialPublishInfo);
  const [publishing, setPublishing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(openPreviewOnLoad);
  const [pendingTypeChange, setPendingTypeChange] = useState<{
    question: QuestionV1;
    to: QuestionType;
    lossy: boolean;
    brokenRuleIds: string[];
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
    | {
        kind: "question";
        id: string;
        label: string;
        ruleIds: string[];
        questionIds: string[];
      }
    | {
        kind: "ending";
        id: string;
        label: string;
        ruleIds: string[];
        questionIds: string[];
      }
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
      ? rulesBrokenByOptionChange(schema, next.id, new Set(remaining.map((o) => o.id)))
      : [];
    if (removed.length > 0) {
      toast(
        removed.length === 1
          ? "1 logic rule removed"
          : `${removed.length} logic rules removed`,
        { description: "They checked an option you just deleted." },
      );
      setSchema((s) =>
        removeRules(
          { ...s, questions: s.questions.map((q) => (q.id === next.id ? next : q)) },
          removed,
        ),
      );
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

  function updateLogic(patch: Partial<FormSchemaV1>) {
    setSchema((s) => ({ ...s, ...patch }));
  }

  /** Rules a type change would break: legacy ones the old rules decided,
   * plus any rule comparing this question's answer as a different kind. */
  function rulesBrokenByTypeChangeAll(question: QuestionV1, to: QuestionType): string[] {
    const legacy = rulesBrokenByTypeChange(
      schema.logic,
      question.id,
      question.type,
      to,
    ).map((r) => r.id);
    const converted = convertQuestion(question, to).question;
    const kindChanges = questionKind(question) !== questionKind(converted);
    const modern = kindChanges
      ? (schema.rules ?? [])
          .filter((r) => r.when && conditionUsesQuestion(r.when, question.id))
          .map((r) => r.id)
      : [];
    return [...new Set([...legacy, ...modern])];
  }

  function track(eventType: "question_added" | "form_previewed", questionType?: string) {
    void trackBuilderEventAction(formId, eventType, questionType).catch(() => undefined);
  }

  function handleAdd(type: QuestionType) {
    track("question_added", type);
    const question = createQuestion(type, schema.questions.length);
    // New questions go after the selected one (or at the end).
    const selectedIndex =
      selection.kind === "question"
        ? schema.questions.findIndex((q) => q.id === selection.id)
        : -1;
    const at = selectedIndex === -1 ? schema.questions.length : selectedIndex + 1;
    setSchema((s) => ({
      ...s,
      questions: insertQuestion(s.questions, question, at),
    }));
    setSelection({ kind: "question", id: question.id });
  }

  function applyTypeChange(question: QuestionV1, to: QuestionType) {
    const converted = convertQuestion(question, to).question;
    const broken = rulesBrokenByTypeChangeAll(question, to);
    setSchema((s) => {
      const next = removeRules(
        {
          ...s,
          questions: s.questions.map((q) => (q.id === question.id ? converted : q)),
        },
        broken,
      );
      // No longer a choice question: anything carrying its options forward
      // keeps the options it had, as its own.
      return CHOICE_TYPES.has(to) ? next : detachOptionsFrom(next, question.id);
    });
  }

  function requestTypeChange(question: QuestionV1, to: QuestionType) {
    if (question.type === to) return;
    const { lossy } = convertQuestion(question, to);
    const brokenRuleIds = rulesBrokenByTypeChangeAll(question, to);
    if (lossy || brokenRuleIds.length > 0) {
      setPendingTypeChange({ question, to, lossy, brokenRuleIds });
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
    const refs = questionReferences(schema, id);
    if (refs.ruleIds.length > 0 || refs.questionIds.length > 0) {
      setPendingDelete({ kind: "question", id, label: question.label, ...refs });
      return;
    }
    commitDeleteQuestion(id);
  }

  function commitDeleteQuestion(id: string) {
    setSchema((s) =>
      removeQuestionReferences({ ...s, questions: removeQuestion(s.questions, id) }, id),
    );
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
    const ruleIds = endingReferences(schema, id);
    if (ruleIds.length > 0) {
      setPendingDelete({
        kind: "ending",
        id,
        label: ending.title,
        ruleIds,
        questionIds: [],
      });
      return;
    }
    commitDeleteEnding(id);
  }

  function commitDeleteEnding(id: string) {
    setSchema((s) =>
      removeEndingReferences({ ...s, endings: removeEnding(s.endings, id) }, id),
    );
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
    const broken = jumpsBrokenByReorder(schema, moved);
    if (broken.length > 0) {
      toast.error("Can't move it there", {
        description:
          "A logic rule would then jump back to an earlier question. Change that rule first.",
      });
      return;
    }
    setSchema((s) => ({ ...s, questions: moveQuestionAt(s.questions, id, direction) }));
  }

  function handleReorder(fromIndex: number, toIndex: number) {
    const moved = reorderQuestions(schema.questions, fromIndex, toIndex);
    if (moved === schema.questions) return;
    const broken = jumpsBrokenByReorder(schema, moved);
    if (broken.length > 0) {
      toast.error("Can't move it there", {
        description:
          "A logic rule would then jump back to an earlier question. Change that rule first.",
      });
      return;
    }
    setSchema((s) => ({
      ...s,
      questions: reorderQuestions(s.questions, fromIndex, toIndex),
    }));
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
      toast.error("Couldn't publish.", {
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
      toast.success(publishInfo.isPublished ? "Republished." : "Published.", {
        description: "Your form is live.",
        action: {
          label: "View live",
          onClick: () => window.open(`/f/${slug}`, "_blank", "noopener"),
        },
      });
    } else {
      toast.error("Couldn't publish.", { description: result.message });
    }
  }

  async function handleUnpublish() {
    setPublishing(true);
    const result = await onUnpublish(formId);
    setPublishing(false);

    if (result.ok) {
      setPublishInfo((p) => ({ ...p, isPublished: false }));
      toast("Unpublished.", {
        description: "The link now says this form isn't available.",
      });
    } else {
      toast.error("Couldn't unpublish.", { description: result.message });
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

  const isLive = publishInfo.isPublished;
  const hasChanges = publishInfo.hasUnpublishedChanges;
  const publishLabel = publishing
    ? "Publishing…"
    : !isLive
      ? "Publish"
      : hasChanges
        ? "Publish changes"
        : "Republish";

  // Respondent-facing numbers: every step after the welcome screen.
  const numbers = new Map<string, number>();
  for (const q of schema.questions) {
    if (q.type !== "welcome_screen") numbers.set(q.id, numbers.size + 1);
  }
  const stepCount = numbers.size;
  const ruleCount = schema.logic.length + (schema.rules?.length ?? 0);
  const currentTitle = schema.meta.title || formTitle;

  // Tab title: "• " while edits haven't reached the server (Part 8).
  const dirty =
    saveState === "saving" || saveState === "error" || saveState === "invalid";
  useEffect(() => {
    document.title = `${dirty ? "• " : ""}${currentTitle} · Build · FormCraft`;
  }, [dirty, currentTitle]);

  const panelTile = (children: React.ReactNode, tint: string) => (
    <span
      aria-hidden
      className="border-ink grid size-[34px] shrink-0 place-items-center rounded-[8px] border-[1.5px]"
      style={{ background: `var(--qt-${tint}-bg)`, color: `var(--qt-${tint}-fg)` }}
    >
      {children}
    </span>
  );

  const selectedIndex = selectedQuestion
    ? schema.questions.findIndex((q) => q.id === selectedQuestion.id)
    : -1;

  return (
    <div className="bg-background flex h-dvh min-h-[600px] flex-col">
      <header className="border-ink bg-card relative z-20 grid h-16 shrink-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 border-b-[1.5px] px-4 max-xl:gap-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/dashboard"
                aria-label="Back to forms"
                className="fc-focus border-border hover:bg-hover-wash grid size-9 shrink-0 place-items-center rounded-sm border-[1.5px]"
              >
                <ArrowLeft className="size-[18px]" />
              </Link>
            </TooltipTrigger>
            <TooltipContent>Back to forms</TooltipContent>
          </Tooltip>
          <FormTitleInput
            title={formTitle}
            onRename={(title) => onRename(formId, title)}
            onTitleChange={(title) =>
              setSchema((s) => ({ ...s, meta: { ...s.meta, title } }))
            }
          />
          <SaveStatus
            state={saveState}
            problem={saveProblem?.message}
            onProblemClick={showProblem}
          />
          {saveState === "stale" && (
            <Button
              size="sm"
              variant="secondary"
              className="h-7 shrink-0 px-3 text-[12.5px]"
              onClick={() => window.location.reload()}
            >
              Reload
            </Button>
          )}
        </div>

        <FormTabs formId={formId} active="build" />

        <div className="flex min-w-0 items-center justify-end gap-2">
          {isLive && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    className="fc-focus flex h-9 items-center rounded-sm px-1.5"
                  >
                    <span
                      className={cn(
                        "size-2.5 rounded-full",
                        hasChanges
                          ? "bg-[var(--chip-changes-dot)] shadow-[0_0_0_3px_var(--chip-changes-bg)]"
                          : "bg-[var(--chip-live-dot)] shadow-[0_0_0_3px_var(--chip-live-bg)]",
                      )}
                    />
                    <span className="sr-only">
                      {hasChanges ? "Unpublished changes" : "Live"}
                    </span>
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-[230px]">
                  {hasChanges
                    ? "Unpublished changes. Respondents still see the last published version."
                    : "Live. Respondents see the latest version."}
                </TooltipContent>
              </Tooltip>
              <SharePopover
                formId={formId}
                slug={slug}
                title={currentTitle}
                description={schema.meta.description}
                primaryColor={schema.theme.primaryColor}
              />
            </>
          )}
          <Button
            variant="outline"
            className="h-9 px-3"
            onClick={() => {
              setPreviewOpen(true);
              track("form_previewed");
            }}
          >
            <Eye /> <span className="max-xl:sr-only">Preview</span>
          </Button>
          <Button
            data-loading={publishing || undefined}
            variant={isLive && !hasChanges && !publishing ? "outline" : "default"}
            className={cn(
              "h-9 px-4 whitespace-nowrap",
              isLive && !hasChanges && !publishing && "border-input shadow-none",
              publishing && "bg-accent shadow-none",
            )}
            disabled={publishing}
            onClick={handlePublish}
          >
            {publishing && <ButtonSpinner />}
            {publishLabel}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="outline"
                className="border-border data-[state=open]:bg-hover-wash size-9"
                aria-label="More publishing options"
              >
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[220px]">
              <DropdownMenuItem
                variant="destructive"
                disabled={!isLive || publishing}
                onSelect={() => void handleUnpublish()}
              >
                <EyeOff /> Unpublish
              </DropdownMenuItem>
              <p className="text-muted-foreground px-2.5 pt-1 pb-1.5 text-xs leading-[1.4]">
                The link stops working until you publish again. Responses are kept.
              </p>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <PreviewDialog
        brandingRemovable={brandingRemovable}
        schema={{
          ...schema,
          theme: themeForPlan(
            schema.theme,
            customFonts,
            process.env.NEXT_PUBLIC_SUPABASE_URL,
          ),
        }}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        onShowProblem={(target) => {
          if (target.questionId)
            setSelection({ kind: "question", id: target.questionId });
          else if (target.endingId) setSelection({ kind: "ending", id: target.endingId });
        }}
      />

      <div
        className={cn(
          "grid min-h-0 flex-1",
          selection.kind === "logic" || selection.kind === "languages"
            ? "grid-cols-[280px_minmax(0,1fr)] max-xl:grid-cols-[248px_minmax(0,1fr)]"
            : "grid-cols-[280px_minmax(0,1fr)_300px] max-xl:grid-cols-[248px_minmax(0,1fr)_300px]",
        )}
      >
        <aside className="border-ink bg-card flex min-h-0 flex-col border-r-[1.5px]">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-2.5 pt-3.5 pb-2.5">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between px-2 pb-1.5">
                <span className="text-muted-foreground text-[11.5px] font-bold tracking-[0.1em] uppercase">
                  Questions · {stepCount}
                </span>
                <span className="text-muted-foreground text-[11.5px]">
                  Drag to reorder
                </span>
              </div>
              <QuestionList
                questions={schema.questions}
                selectedId={selection.kind === "question" ? selection.id : null}
                invalidId={saveState === "invalid" ? saveProblem?.questionId : null}
                onSelect={(id) => setSelection({ kind: "question", id })}
                onMove={handleMove}
                onReorder={handleReorder}
                onDuplicate={handleDuplicate}
                onDelete={requestDeleteQuestion}
              />
              <AddQuestionMenu
                onAdd={handleAdd}
                canAddWelcome={!schema.questions.some((q) => q.type === "welcome_screen")}
              />
            </div>

            {!hasLeadCapture(schema.questions) && (
              <div className="border-input bg-background flex flex-col gap-1.5 rounded-sm border-[1.5px] border-dashed p-3">
                <p className="flex items-center gap-1.5 text-[13.5px] font-bold">
                  <Contact className="size-4" />
                  Capture leads
                </p>
                <p className="text-muted-foreground text-xs leading-[1.45]">
                  Ask for name, email and phone before your last question. Details are
                  saved the moment they&apos;re entered, even if the person never submits.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1 self-start"
                  onClick={handleAddLeadCapture}
                >
                  <Plus /> Add lead capture
                </Button>
              </div>
            )}

            <div className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between px-2 pb-1.5">
                <span className="text-muted-foreground text-[11.5px] font-bold tracking-[0.1em] uppercase">
                  Endings
                </span>
                <button
                  type="button"
                  onClick={handleAddEnding}
                  aria-label="Add ending"
                  title="Add ending"
                  className="fc-focus border-ink bg-card hover:bg-hover-wash grid size-6 place-items-center rounded-[5px] border-[1.5px]"
                >
                  <Plus className="size-[13px]" />
                </button>
              </div>
              <ol className="flex flex-col gap-0.5" aria-label="Endings">
                {schema.endings.map((ending) => {
                  const on = selection.kind === "ending" && selection.id === ending.id;
                  const label = ending.title || "Untitled ending";
                  return (
                    <li
                      key={ending.id}
                      className={cn(
                        "group relative flex h-10 items-center gap-2 rounded-sm pr-1.5 pl-2.5",
                        on
                          ? "bg-secondary text-secondary-foreground"
                          : "hover:bg-hover-wash",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setSelection({ kind: "ending", id: ending.id })}
                        aria-current={on || undefined}
                        className="focus-visible:after:shadow-focus flex min-w-0 flex-1 items-center gap-2 self-stretch text-left outline-none after:absolute after:inset-0 after:rounded-sm"
                      >
                        <span
                          aria-hidden
                          className="border-ink grid size-6 shrink-0 place-items-center rounded-[6px] border-[1.5px] bg-[var(--qt-screens-bg)] text-[var(--qt-screens-fg)]"
                        >
                          <Flag className="size-[13px]" />
                        </span>
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-[13.5px]",
                            on ? "font-bold" : "font-medium",
                          )}
                        >
                          {label}
                        </span>
                        {ending.isDefault && (
                          <span
                            className={cn(
                              "rounded-full border-[1.5px] px-[7px] py-px text-[10.5px] font-bold",
                              on
                                ? "border-[#6f6254] text-[#e2d5c0]"
                                : "border-input text-muted-foreground",
                            )}
                          >
                            default
                          </span>
                        )}
                      </button>
                      {canDeleteEnding(schema.endings, ending.id) && (
                        <button
                          type="button"
                          onClick={() => requestDeleteEnding(ending.id)}
                          aria-label={`Delete ending "${label}"`}
                          className={cn(
                            "fc-focus hover:bg-hover-wash-strong relative grid size-6 place-items-center rounded-xs",
                            !on &&
                              "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
                          )}
                        >
                          <X className="size-[13px]" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="border-border flex flex-col gap-0.5 border-t-[1.5px] pt-2.5">
              {[
                {
                  kind: "theme" as const,
                  label: "Design",
                  icon: <Palette className="size-[13px]" />,
                  tint: "scale",
                  meta: null,
                },
                {
                  kind: "languages" as const,
                  label: "Languages",
                  icon: <Languages className="size-[13px]" />,
                  tint: "choice",
                  meta: schema.languages?.others.length
                    ? `${schema.languages.others.length + 1} languages`
                    : null,
                },
                {
                  kind: "logic" as const,
                  label: "Logic",
                  icon: <Split className="size-[13px]" />,
                  tint: "other",
                  meta:
                    ruleCount > 0
                      ? `${ruleCount} rule${ruleCount === 1 ? "" : "s"}`
                      : null,
                },
              ].map((row) => {
                const on = selection.kind === row.kind;
                return (
                  <button
                    key={row.kind}
                    type="button"
                    aria-current={on || undefined}
                    onClick={() => setSelection({ kind: row.kind })}
                    className={cn(
                      "fc-focus flex h-[42px] items-center gap-2.5 rounded-sm px-2.5 text-left text-sm font-semibold",
                      on
                        ? "bg-secondary text-secondary-foreground"
                        : "hover:bg-hover-wash",
                    )}
                  >
                    <span
                      aria-hidden
                      className="border-ink grid size-6 shrink-0 place-items-center rounded-[6px] border-[1.5px]"
                      style={{
                        background: `var(--qt-${row.tint}-bg)`,
                        color: `var(--qt-${row.tint}-fg)`,
                      }}
                    >
                      {row.icon}
                    </span>
                    <span className="flex-1">{row.label}</span>
                    {row.meta && (
                      <span className="text-xs font-medium opacity-75">{row.meta}</span>
                    )}
                    {!row.meta && <ChevronRight className="size-4 opacity-40" />}
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <main className="bg-board relative min-h-0 min-w-0 overflow-auto bg-[radial-gradient(var(--board-dot)_1px,transparent_1px)] bg-size-[18px_18px]">
          {selection.kind === "languages" ? (
            <TranslationsEditor
              schema={schema}
              onChange={updateLogic}
              allowed={multilingual}
            />
          ) : selection.kind === "logic" ? (
            <LogicEditor
              schema={schema}
              onChange={updateLogic}
              onSelectQuestion={(id) => setSelection({ kind: "question", id })}
              ai={
                onProposeRule
                  ? {
                      enabled: aiEnabled,
                      propose: (instruction) =>
                        onProposeRule(formId, instruction, schema),
                    }
                  : undefined
              }
            />
          ) : (
            <BuilderCanvas
              brandingRemovable={brandingRemovable}
              theme={themeForPlan(
                schema.theme,
                customFonts,
                process.env.NEXT_PUBLIC_SUPABASE_URL,
              )}
              item={
                selectedQuestion
                  ? {
                      kind: "question",
                      question: selectedQuestion,
                      number: numbers.get(selectedQuestion.id) ?? 0,
                      total: stepCount,
                      isLast: selectedIndex === schema.questions.length - 1,
                    }
                  : selectedEnding
                    ? { kind: "ending", ending: selectedEnding }
                    : { kind: "theme" }
              }
              onChangeQuestion={updateQuestion}
              onChangeEnding={updateEnding}
            />
          )}
        </main>

        {selection.kind !== "logic" && selection.kind !== "languages" && (
          <aside className="border-ink bg-card min-h-0 overflow-y-auto border-l-[1.5px]">
            <div className="flex flex-col gap-[18px] px-[18px] pt-[18px] pb-10">
              {selectedQuestion && (
                <PanelHeader
                  tile={<TypeTile type={selectedQuestion.type} size={34} />}
                  title={QUESTION_TYPE_META[selectedQuestion.type].label}
                  subtitle={
                    selectedQuestion.type === "welcome_screen"
                      ? "Always shown first"
                      : `Question ${numbers.get(selectedQuestion.id)} of ${stepCount}`
                  }
                />
              )}
              {selectedEnding && (
                <PanelHeader
                  tile={panelTile(<Flag className="size-[17px]" />, "screens")}
                  title={selectedEnding.isDefault ? "Default ending" : "Ending"}
                  subtitle={
                    selectedEnding.isDefault
                      ? "Shown when no rule picks another ending"
                      : "Reached through logic rules"
                  }
                />
              )}
              {selection.kind === "theme" && (
                <PanelHeader
                  tile={panelTile(<Palette className="size-[17px]" />, "scale")}
                  title="Design"
                  subtitle="Applies to the whole form"
                />
              )}
              {selectedProblem && <NotSavedAlert>{selectedProblem}</NotSavedAlert>}
              {selectedQuestion && (
                <SettingsPanel
                  workspaceId={workspaceId}
                  formId={formId}
                  question={selectedQuestion}
                  invalid={!!selectedProblem}
                  onChange={updateQuestion}
                  onChangeType={(to) => requestTypeChange(selectedQuestion, to)}
                  earlierChoices={numberedQuestions(schema)
                    .filter(
                      ({ question: q }) =>
                        CHOICE_TYPES.has(q.type) && q.order < selectedQuestion.order,
                    )
                    .map(({ question: q, number }) => ({
                      id: q.id,
                      number,
                      label: q.label.trim() || "Untitled",
                    }))}
                />
              )}
              {selectedQuestion && (
                <QuestionLogicPanel
                  schema={schema}
                  question={selectedQuestion}
                  onChange={updateQuestion}
                  onSchemaChange={updateLogic}
                />
              )}
              {selectedEnding && (
                <EndingSettingsPanel
                  key={selectedEnding.id}
                  ending={selectedEnding}
                  onChange={updateEnding}
                  meta={schema.meta}
                  onMetaChange={(meta) => setSchema((s) => ({ ...s, meta }))}
                  brandingRemovable={brandingRemovable}
                />
              )}
              {selection.kind === "theme" && (
                <ThemeSettingsPanel
                  theme={schema.theme}
                  workspaceId={workspaceId}
                  formId={formId}
                  onChange={updateTheme}
                  customFonts={customFonts}
                />
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Below 1024px the builder doesn't fit; offer what does (Part 4). */}
      <div className="bg-background fixed inset-0 z-40 flex flex-col gap-[18px] px-6 pt-6 pb-7 lg:hidden">
        <div className="flex items-center gap-2.5">
          <Link
            href="/dashboard"
            aria-label="Back to forms"
            className="fc-focus border-border grid size-11 place-items-center rounded-sm border-[1.5px]"
          >
            <ArrowLeft className="size-[18px]" />
          </Link>
          <b className="font-heading truncate text-base">{currentTitle}</b>
        </div>
        <div className="flex flex-1 flex-col justify-center gap-3.5">
          <div aria-hidden className="relative h-[100px] w-[130px]">
            <div className="border-ink bg-card shadow-card absolute top-3.5 left-0 h-[72px] w-[110px] rounded-[8px] border-[1.5px]" />
            <div className="border-ink bg-primary absolute top-0 right-0 h-20 w-11 rotate-8 rounded-[8px] border-[1.5px]" />
          </div>
          <h2 className="font-heading text-[30px] leading-[1.05] font-bold tracking-[-0.03em]">
            The builder is best on a bigger screen
          </h2>
          <p className="text-muted-foreground text-[15.5px] leading-[1.55]">
            Editing questions, logic and themes needs room. On your phone you can still
            preview, share and read responses.
          </p>
        </div>
        <Button
          size="lg"
          className="h-[50px] text-base"
          onClick={() => setPreviewOpen(true)}
        >
          Preview form
        </Button>
        <div className="grid grid-cols-2 gap-2.5">
          <Button
            variant="outline"
            size="lg"
            disabled={!isLive}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(publicFormUrl(slug));
                toast.success("Link copied.", {
                  description: "Paste it anywhere to share.",
                });
              } catch {
                toast.error("Couldn't copy the link.");
              }
            }}
          >
            Share link
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href={`/forms/${formId}/responses`}>Responses</Link>
          </Button>
        </div>
        {!isLive && (
          <p className="text-muted-foreground text-center text-[13.5px]">
            Publish on a bigger screen to get a link.
          </p>
        )}
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
                pendingTypeChange.brokenRuleIds.length > 0 &&
                `${pendingTypeChange.brokenRuleIds.length} logic rule${pendingTypeChange.brokenRuleIds.length === 1 ? "" : "s"} based on its answer will be removed. `}
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
            <AlertDialogMedia>
              <GitBranch />
            </AlertDialogMedia>
            <AlertDialogTitle>
              {pendingDelete?.kind === "ending"
                ? `Delete the ending “${pendingDelete.label || "Untitled ending"}”?`
                : `Delete “${pendingDelete?.label || "Untitled question"}”?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete && deleteSummary(pendingDelete)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingDelete && (
            <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
              {allRules(schema)
                .map((rule, i) => ({ rule, n: i + 1 }))
                .filter(({ rule }) => pendingDelete.ruleIds.includes(rule.id))
                .map(({ rule, n }) => (
                  <li
                    key={rule.id}
                    className="bg-background flex items-center gap-2 rounded-sm px-2.5 py-[7px] text-[13px]"
                  >
                    <b className="bg-secondary text-primary grid size-5 shrink-0 place-items-center rounded-full text-[11px]">
                      {n}
                    </b>
                    <span className="min-w-0">{describeRule(rule, schema)}</span>
                  </li>
                ))}
              {pendingDelete.questionIds.map((qid) => (
                <li
                  key={qid}
                  className="bg-background flex items-center gap-2 rounded-sm px-2.5 py-[7px] text-[13px]"
                >
                  <span className="min-w-0">
                    {questionName(schema, qid)}: its show condition or check uses this, so
                    that part goes too.
                  </span>
                </li>
              ))}
            </ul>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmPendingDelete}>
              <Trash2 /> Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
