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
}: {
  question: QuestionV1;
  value: unknown;
  onChange: (value: unknown) => void;
  primaryColor: string;
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
      return <FileUploadInput question={question} value={value} onChange={onChange} />;
  }
}

function FileUploadInput({
  value,
  onChange,
}: {
  question: Extract<QuestionV1, { type: "file_upload" }>;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [fileName, setFileName] = useState<string | null>(
    typeof value === "string" ? value : null,
  );

  return (
    <label className="border-input hover:bg-accent/50 flex h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed text-sm">
      <span>{fileName ? fileName : "Click to choose a file"}</span>
      <input
        type="file"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          setFileName(file?.name ?? null);
          // Actual upload/persistence lands with the response-submission
          // milestone — this records the filename locally so the
          // required-field check and review screen behave correctly.
          onChange(file?.name);
        }}
      />
    </label>
  );
}
