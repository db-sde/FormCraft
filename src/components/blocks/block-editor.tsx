"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import type { QuestionV1 } from "@/domains/forms/schema/v1";
import { QuestionV1 as QuestionSchema } from "@/domains/forms/schema/v1";
import { createQuestion, pictureChoiceQuestion } from "@/domains/forms/builder";
import { publishBlockVersionAction } from "@/app/(dashboard)/blocks/actions";
import { SettingsPanel } from "@/components/builder/settings-panel";
import { AddQuestionMenu } from "@/components/builder/add-question-menu";
import { QUESTION_TYPE_META, TypeTile } from "@/components/builder/question-meta";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/toast";

/**
 * Editing a shared block (F-09): its name and questions, published as the
 * next version. Publishing changes no form by itself — each form that
 * uses the block is offered the update and its editors decide.
 */
export function BlockEditor({
  blockId,
  workspaceId,
  initial,
  canEdit,
}: {
  blockId: string;
  workspaceId: string;
  initial: {
    name: string;
    description: string | null;
    version: number;
    questions: QuestionV1[];
  };
  canEdit: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [questions, setQuestions] = useState(initial.questions);
  const [open, setOpen] = useState<string | null>(initial.questions[0]?.id ?? null);
  const [publishing, start] = useTransition();
  const dirty =
    name !== initial.name ||
    description !== (initial.description ?? "") ||
    JSON.stringify(questions) !== JSON.stringify(initial.questions);

  const update = (next: QuestionV1) =>
    setQuestions((qs) => qs.map((q) => (q.id === next.id ? next : q)));
  const move = (index: number, by: number) =>
    setQuestions((qs) => {
      const next = [...qs];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item);
      return next.map((q, order) => ({ ...q, order }));
    });

  function publish() {
    const invalid = questions.find((q) => !QuestionSchema.safeParse(q).success);
    if (invalid) {
      toast.error("Not published", {
        description: `“${invalid.label || "A question"}” has a setting that isn't valid.`,
      });
      setOpen(invalid.id);
      return;
    }
    start(async () => {
      const result = await publishBlockVersionAction(blockId, {
        name,
        description,
        questions,
      });
      if (!result.ok) {
        toast.error("Not published", { description: result.message });
        return;
      }
      toast.success(`Version ${result.version} published.`, {
        description: "Forms that use this block will be offered the update.",
      });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5" data-testid="block-editor">
      <fieldset disabled={!canEdit} className="contents">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="block-name">Name</Label>
            <Input
              id="block-name"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="block-description">Description</Label>
            <Input
              id="block-description"
              value={description}
              maxLength={500}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <ol className="flex flex-col gap-3" aria-label="Questions in the block">
          {questions.map((q, index) => (
            <li key={q.id} className="border-ink bg-card rounded-lg border-[1.5px]">
              <div className="flex items-center gap-2 p-3">
                <TypeTile type={q.type} size={24} />
                <Input
                  aria-label={`Question ${index + 1} text`}
                  value={q.label}
                  onChange={(e) => update({ ...q, label: e.target.value })}
                  className="h-9 flex-1"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Move up"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ChevronUp className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Move down"
                  disabled={index === questions.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ChevronDown className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove question"
                  disabled={questions.length === 1}
                  onClick={() => setQuestions((qs) => qs.filter((x) => x.id !== q.id))}
                >
                  <Trash2 className="size-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  aria-expanded={open === q.id}
                  onClick={() => setOpen(open === q.id ? null : q.id)}
                >
                  {open === q.id ? "Hide settings" : "Settings"}
                </Button>
              </div>
              {open === q.id && (
                <div className="border-border flex flex-col gap-4 border-t p-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor={`desc-${q.id}`}>Description</Label>
                    <Input
                      id={`desc-${q.id}`}
                      value={q.description ?? ""}
                      onChange={(e) =>
                        update({ ...q, description: e.target.value || undefined })
                      }
                    />
                  </div>
                  <SettingsPanel
                    question={q}
                    onChange={update}
                    workspaceId={workspaceId}
                    formId={blockId}
                    layout="classic"
                  />
                  <p className="text-muted-foreground text-xs">
                    {QUESTION_TYPE_META[q.type].label}. Show conditions, checks and option
                    points are set in each form, not here.
                  </p>
                </div>
              )}
            </li>
          ))}
        </ol>
        <div className="max-w-xs">
          <AddQuestionMenu
            canAddWelcome={false}
            onAdd={(kind) => {
              const q =
                kind === "picture_choice"
                  ? pictureChoiceQuestion(questions.length)
                  : createQuestion(kind, questions.length);
              setQuestions((qs) => [...qs, q]);
              setOpen(q.id);
            }}
          />
        </div>
      </fieldset>
      {canEdit && (
        <div className="flex items-center gap-3">
          <Button
            onClick={publish}
            disabled={!dirty || publishing}
            data-loading={publishing || undefined}
          >
            {publishing && <ButtonSpinner />}
            Publish version {initial.version + 1}
          </Button>
          <span className="text-muted-foreground text-[13px]">
            {dirty ? "Unpublished changes." : `Showing version ${initial.version}.`}
          </span>
        </div>
      )}
    </div>
  );
}
