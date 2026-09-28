"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { FormSchemaV1, QuestionV1, EndingV1 } from "@/domains/forms/schema/v1";
import type { QuestionType } from "@/domains/forms/schema/question-types";
import {
  createQuestion,
  insertQuestion,
  removeQuestion,
  duplicateQuestion as duplicateQuestionAt,
  moveQuestion as moveQuestionAt,
} from "@/domains/forms/builder";
import type { SaveDraftResult } from "@/app/(builder)/forms/[id]/actions";
import { QuestionList } from "./question-list";
import { AddQuestionMenu } from "./add-question-menu";
import { QuestionEditor } from "./question-editor";
import { SettingsPanel } from "./settings-panel";
import { EndingEditor, EndingSettingsPanel } from "./ending-editor";
import { SaveStatus, type SaveState } from "./save-status";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Selection = { kind: "question"; id: string } | { kind: "ending"; id: string };

const AUTOSAVE_DEBOUNCE_MS = 800;

export function FormBuilder({
  formTitle,
  draftVersionId,
  initialRevision,
  initialSchema,
  onSave,
}: {
  formTitle: string;
  draftVersionId: string;
  initialRevision: number;
  initialSchema: FormSchemaV1;
  onSave: (
    draftVersionId: string,
    expectedRevision: number,
    schema: FormSchemaV1,
  ) => Promise<SaveDraftResult>;
}) {
  const [schema, setSchema] = useState(initialSchema);
  const [selection, setSelection] = useState<Selection>({
    kind: "question",
    id: initialSchema.questions[0]?.id,
  });
  const [saveState, setSaveState] = useState<SaveState>("idle");

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

  function handleAdd(type: QuestionType) {
    const question = createQuestion(type, schema.questions.length);
    setSchema((s) => ({
      ...s,
      questions: insertQuestion(s.questions, question, s.questions.length),
    }));
    setSelection({ kind: "question", id: question.id });
  }

  function handleDelete(id: string) {
    setSchema((s) => {
      const questions = removeQuestion(s.questions, id);
      if (selection.kind === "question" && selection.id === id) {
        setSelection(
          questions.length > 0
            ? { kind: "question", id: questions[0].id }
            : { kind: "ending", id: s.endings[0].id },
        );
      }
      return { ...s, questions };
    });
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
          <SaveStatus state={saveState} />
          {saveState === "stale" && (
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
              Reload
            </Button>
          )}
          <Separator orientation="vertical" className="h-5" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="outline" disabled>
                Preview
              </Button>
            </TooltipTrigger>
            <TooltipContent>Coming soon</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" disabled>
                Publish
              </Button>
            </TooltipTrigger>
            <TooltipContent>Coming soon</TooltipContent>
          </Tooltip>
        </div>
      </header>

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
              onDelete={handleDelete}
            />
          </div>
          <AddQuestionMenu onAdd={handleAdd} />

          <Separator />

          <div>
            <p className="text-muted-foreground mb-2 px-1 text-xs font-medium tracking-wide uppercase">
              Endings
            </p>
            <ol className="flex flex-col gap-1">
              {schema.endings.map((ending) => (
                <li key={ending.id}>
                  <button
                    type="button"
                    onClick={() => setSelection({ kind: "ending", id: ending.id })}
                    className={
                      "w-full truncate rounded-md border px-2 py-1.5 text-left text-sm " +
                      (selection.kind === "ending" && selection.id === ending.id
                        ? "border-foreground/20 bg-accent"
                        : "hover:bg-accent/50 border-transparent")
                    }
                  >
                    {ending.title || "Ending"}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto px-10 py-12">
          {selectedQuestion && (
            <QuestionEditor question={selectedQuestion} onChange={updateQuestion} />
          )}
          {selectedEnding && (
            <EndingEditor ending={selectedEnding} onChange={updateEnding} />
          )}
        </main>

        <aside className="w-80 shrink-0 overflow-y-auto border-l p-4">
          {selectedQuestion && (
            <SettingsPanel question={selectedQuestion} onChange={updateQuestion} />
          )}
          {selectedEnding && (
            <EndingSettingsPanel ending={selectedEnding} onChange={updateEnding} />
          )}
        </aside>
      </div>
    </div>
  );
}
