"use client";

import { useState, useTransition } from "react";
import { PencilLine } from "lucide-react";
import { toast } from "sonner";
import type { QuestionV1 } from "@/domains/forms/schema/v1";
import { correctAnswerAction } from "@/app/(form)/forms/[id]/(sections)/responses/records-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** What the editor holds while typing: text for most types. */
function startingDraft(question: QuestionV1, value: unknown): unknown {
  if (value === undefined || value === null) {
    return question.type === "multi_select" ? [] : "";
  }
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  return value;
}

/** The draft as an answer value, the shape the respondent's form sends. */
function draftToValue(question: QuestionV1, draft: unknown): unknown {
  switch (question.type) {
    case "number":
    case "rating":
    case "opinion_scale": {
      const text = String(draft ?? "").trim();
      return text === "" ? null : Number(text);
    }
    case "yes_no":
      return draft === "yes" ? true : draft === "no" ? false : null;
    case "multi_select":
      return Array.isArray(draft) && draft.length ? draft : null;
    default: {
      const text = typeof draft === "string" ? draft : "";
      return text.trim() === "" ? null : text;
    }
  }
}

/**
 * "Correct" on an answer of a submitted response (roadmap #55): the new
 * value and a reason; the original stays in the history below the answer.
 */
export function CorrectAnswer({
  formId,
  responseId,
  question,
  label,
  value,
}: {
  formId: string;
  responseId: string;
  question: QuestionV1;
  label: string;
  value: unknown;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<unknown>(() => startingDraft(question, value));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fieldId = `correct-${question.id}`;

  function save() {
    setError(null);
    start(async () => {
      const result = await correctAnswerAction(
        formId,
        responseId,
        question.id,
        draftToValue(question, draft),
        reason,
      );
      if (result.ok) {
        toast.success("Answer corrected", {
          description: "The original is kept in its history.",
        });
        setOpen(false);
        setReason("");
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground -my-1 ml-auto h-7 shrink-0 px-2 text-xs"
        aria-label={`Correct the answer to “${label}”`}
        onClick={() => {
          setDraft(startingDraft(question, value));
          setError(null);
          setOpen(true);
        }}
      >
        <PencilLine className="size-3.5" /> Correct
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Correct this answer</DialogTitle>
            <DialogDescription>
              {label}. The respondent&apos;s original and every correction stay in the
              answer&apos;s history. Integrations aren&apos;t sent the change unless you
              replay them.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <label htmlFor={fieldId} className="text-[13px] font-semibold">
              New answer
            </label>
            <ValueEditor
              id={fieldId}
              question={question}
              draft={draft}
              onChange={setDraft}
            />
            <label htmlFor={`${fieldId}-reason`} className="text-[13px] font-semibold">
              Reason
            </label>
            <Textarea
              id={`${fieldId}-reason`}
              rows={2}
              value={reason}
              maxLength={500}
              required
              minLength={3}
              placeholder="Like: respondent emailed to fix a typo in their address"
              onChange={(e) => setReason(e.target.value)}
            />
            {error && (
              <p role="alert" className="text-destructive text-[13px]">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || reason.trim().length < 3}>
                {pending ? "Saving…" : "Save correction"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ValueEditor({
  id,
  question,
  draft,
  onChange,
}: {
  id: string;
  question: QuestionV1;
  draft: unknown;
  onChange: (draft: unknown) => void;
}) {
  const text = typeof draft === "string" ? draft : "";
  const selectClass =
    "border-input bg-field h-9 w-full rounded-sm border-[1.5px] px-2 text-sm";
  switch (question.type) {
    case "long_text":
      return (
        <Textarea
          id={id}
          rows={4}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "single_select":
    case "dropdown":
      return (
        <select
          id={id}
          className={selectClass}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">No answer</option>
          {question.settings.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "multi_select": {
      const chosen = Array.isArray(draft) ? (draft as string[]) : [];
      return (
        <fieldset id={id} className="flex flex-col gap-1.5">
          {question.settings.options.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={chosen.includes(o.id)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...chosen, o.id]
                      : chosen.filter((c) => c !== o.id),
                  )
                }
              />
              {o.label}
            </label>
          ))}
        </fieldset>
      );
    }
    case "yes_no":
      return (
        <select
          id={id}
          className={selectClass}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">No answer</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      );
    case "number":
    case "rating":
    case "opinion_scale":
      return (
        <Input
          id={id}
          type="number"
          value={text}
          min={
            question.type === "rating"
              ? 1
              : question.type === "opinion_scale"
                ? question.settings.min
                : undefined
          }
          max={
            question.type === "rating"
              ? question.settings.scale
              : question.type === "opinion_scale"
                ? question.settings.max
                : undefined
          }
          onChange={(e) => onChange(e.target.value)}
        />
      );
    default:
      return (
        <Input
          id={id}
          type={
            question.type === "email"
              ? "email"
              : question.type === "date"
                ? "date"
                : question.type === "time"
                  ? "time"
                  : question.type === "phone"
                    ? "tel"
                    : "text"
          }
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
