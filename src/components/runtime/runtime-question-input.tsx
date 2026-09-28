"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import type { QuestionV1 } from "@/domains/forms/schema/v1";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

const OTHER_OPTION_ID = "__other__";

/** The real, working input for each question type — distinct from
 * question-preview-control.tsx (which renders a disabled mockup for
 * the builder's center pane). Used by both the builder's Preview
 * dialog and the public runtime, so behavior never drifts between
 * them (same principle as the shared logic engine). */
export function RuntimeQuestionInput({
  question,
  value,
  onChange,
  primaryColor,
  responseId,
}: {
  question: QuestionV1;
  value: unknown;
  onChange: (value: unknown) => void;
  primaryColor: string;
  /** Only present in the real public runtime, never the builder's
   * Preview dialog — file_upload uses this to know whether it can
   * actually upload (Preview just tracks a filename locally, keeping
   * its no-network-calls guarantee). */
  responseId?: string;
}) {
  switch (question.type) {
    case "welcome_screen":
    case "statement":
      return null;

    case "short_text":
      return (
        <Input
          autoFocus
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={question.settings.placeholder}
          maxLength={question.settings.maxLength}
        />
      );

    case "long_text":
      return (
        <Textarea
          autoFocus
          rows={4}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={question.settings.placeholder}
          maxLength={question.settings.maxLength}
        />
      );

    case "email":
      return (
        <Input
          autoFocus
          type="email"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="name@example.com"
        />
      );

    case "phone":
      return (
        <Input
          autoFocus
          type="tel"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="+1 555 000 0000"
        />
      );

    case "url":
      return (
        <Input
          autoFocus
          type="url"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://example.com"
        />
      );

    case "number":
      return (
        <Input
          autoFocus
          type="number"
          value={typeof value === "number" ? value : ""}
          min={question.settings.min}
          max={question.settings.max}
          onChange={(e) =>
            onChange(e.target.value === "" ? undefined : Number(e.target.value))
          }
        />
      );

    case "date":
      return (
        <Input
          autoFocus
          type="date"
          value={typeof value === "string" ? value : ""}
          min={question.settings.minDate}
          max={question.settings.maxDate}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "single_select": {
      const selected = typeof value === "string" ? value : "";
      const isOther = selected === OTHER_OPTION_ID;
      return (
        <RadioGroup
          value={isOther ? OTHER_OPTION_ID : selected}
          onValueChange={onChange}
          className="gap-2"
        >
          {question.settings.options.map((o) => (
            <label
              key={o.id}
              className="hover:bg-accent/50 flex cursor-pointer items-center gap-2 rounded-md border p-2.5 text-sm"
            >
              <RadioGroupItem value={o.id} />
              {o.label}
            </label>
          ))}
          {question.settings.allowOther && (
            <label className="hover:bg-accent/50 flex cursor-pointer items-center gap-2 rounded-md border p-2.5 text-sm">
              <RadioGroupItem value={OTHER_OPTION_ID} />
              Other
            </label>
          )}
          {isOther && (
            <Input
              autoFocus
              placeholder="Enter your answer"
              className="mt-1"
              onChange={(e) =>
                onChange(e.target.value ? `other:${e.target.value}` : OTHER_OPTION_ID)
              }
            />
          )}
        </RadioGroup>
      );
    }

    case "multi_select": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      function toggle(id: string) {
        onChange(
          selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id],
        );
      }
      return (
        <div className="flex flex-col gap-2">
          {question.settings.options.map((o) => (
            <label
              key={o.id}
              className="hover:bg-accent/50 flex cursor-pointer items-center gap-2 rounded-md border p-2.5 text-sm"
            >
              <Checkbox
                checked={selected.includes(o.id)}
                onCheckedChange={() => toggle(o.id)}
              />
              {o.label}
            </label>
          ))}
        </div>
      );
    }

    case "dropdown":
      return (
        <select
          autoFocus
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
        >
          <option value="" disabled>
            Choose an option
          </option>
          {question.settings.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      );

    case "yes_no":
      return (
        <div className="flex gap-3">
          <Button
            type="button"
            variant={value === true ? "default" : "outline"}
            onClick={() => onChange(true)}
          >
            {question.settings.yesLabel || "Yes"}
          </Button>
          <Button
            type="button"
            variant={value === false ? "default" : "outline"}
            onClick={() => onChange(false)}
          >
            {question.settings.noLabel || "No"}
          </Button>
        </div>
      );

    case "rating": {
      const rating = typeof value === "number" ? value : 0;
      return (
        <div className="flex gap-1">
          {Array.from({ length: question.settings.scale }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              className="p-0.5"
            >
              <Star
                className={cn(
                  "size-7",
                  n <= rating ? "fill-current" : "text-muted-foreground",
                )}
                style={n <= rating ? { color: primaryColor } : undefined}
              />
            </button>
          ))}
        </div>
      );
    }

    case "opinion_scale": {
      const chosen = typeof value === "number" ? value : undefined;
      const nums = Array.from(
        { length: question.settings.max - question.settings.min + 1 },
        (_, i) => question.settings.min + i,
      );
      return (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {nums.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onChange(n)}
                className={cn(
                  "flex size-9 items-center justify-center rounded-md border text-sm",
                  chosen === n ? "text-white" : "hover:bg-accent/50",
                )}
                style={
                  chosen === n
                    ? { backgroundColor: primaryColor, borderColor: primaryColor }
                    : undefined
                }
              >
                {n}
              </button>
            ))}
          </div>
          {(question.settings.leftLabel || question.settings.rightLabel) && (
            <div className="text-muted-foreground flex justify-between text-xs">
              <span>{question.settings.leftLabel}</span>
              <span>{question.settings.rightLabel}</span>
            </div>
          )}
        </div>
      );
    }

    case "file_upload":
      return (
        <FileUploadInput
          question={question}
          value={value}
          onChange={onChange}
          responseId={responseId}
        />
      );
  }
}

function FileUploadInput({
  question,
  value,
  onChange,
  responseId,
}: {
  question: Extract<QuestionV1, { type: "file_upload" }>;
  value: unknown;
  onChange: (value: unknown) => void;
  responseId?: string;
}) {
  const [fileName, setFileName] = useState<string | null>(
    typeof value === "string" ? value : null,
  );
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);

    if (!responseId) {
      // Preview mode: no network calls at all (see FormRuntime's
      // module doc) — just reflect the filename locally so required-
      // field validation and the visual state behave sensibly.
      onChange(file.name);
      return;
    }

    setStatus("uploading");
    try {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch(`/api/responses/${responseId}/uploads/${question.id}`, {
        method: "POST",
        body,
      });
      if (!res.ok) {
        setStatus("error");
        onChange(undefined);
        return;
      }
      const data = (await res.json()) as { uploadId: string };
      setStatus("idle");
      // The answer value is the upload reference id, never the raw
      // file or a public URL — see docs/api.md.
      onChange(data.uploadId);
    } catch {
      setStatus("error");
      onChange(undefined);
    }
  }

  return (
    <div className="space-y-1.5">
      <label className="border-input hover:bg-accent/50 flex h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed text-sm">
        <span>
          {status === "uploading"
            ? "Uploading…"
            : fileName
              ? fileName
              : "Click to choose a file"}
        </span>
        <span className="text-muted-foreground text-xs">
          Up to {question.settings.maxSizeMb}MB
        </span>
        <input
          type="file"
          className="sr-only"
          disabled={status === "uploading"}
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
      </label>
      {status === "error" && (
        <p className="text-sm text-red-600">
          Upload failed — please try a different file.
        </p>
      )}
    </div>
  );
}
