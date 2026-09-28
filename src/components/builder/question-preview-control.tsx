"use client";

import type { QuestionV1 } from "@/domains/forms/schema/v1";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Star, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A non-interactive, disabled preview of what this question's input
 * will look like to a respondent — gives the creator a WYSIWYG sense
 * of the question without building a second live-input tree here (the
 * real interactive runtime is the public form, built separately). */
export function QuestionPreviewControl({ question }: { question: QuestionV1 }) {
  switch (question.type) {
    case "welcome_screen":
      return (
        <Button type="button" disabled className="pointer-events-none">
          {question.settings.buttonLabel || "Start"}
        </Button>
      );
    case "statement":
      return (
        <Button type="button" disabled className="pointer-events-none">
          {question.settings.buttonLabel || "Continue"}
        </Button>
      );
    case "short_text":
      return (
        <Input
          disabled
          placeholder={question.settings.placeholder || "Type your answer"}
        />
      );
    case "long_text":
      return (
        <Textarea
          disabled
          rows={3}
          placeholder={question.settings.placeholder || "Type your answer"}
        />
      );
    case "email":
      return <Input disabled placeholder="name@example.com" />;
    case "phone":
      return <Input disabled placeholder="+1 555 000 0000" />;
    case "url":
      return <Input disabled placeholder="https://example.com" />;
    case "number":
      return <Input disabled type="number" placeholder="0" />;
    case "date":
      return <Input disabled type="date" />;
    case "single_select":
      return (
        <RadioGroup disabled className="gap-2">
          {question.settings.options.map((o) => (
            <div key={o.id} className="flex items-center gap-2">
              <RadioGroupItem value={o.id} id={o.id} disabled />
              <label htmlFor={o.id} className="text-sm">
                {o.label}
              </label>
            </div>
          ))}
        </RadioGroup>
      );
    case "multi_select":
      return (
        <div className="space-y-2">
          {question.settings.options.map((o) => (
            <div key={o.id} className="flex items-center gap-2">
              <Checkbox disabled id={o.id} />
              <label htmlFor={o.id} className="text-sm">
                {o.label}
              </label>
            </div>
          ))}
        </div>
      );
    case "dropdown":
      return (
        <select
          disabled
          className="border-input h-9 w-full rounded-md border px-3 text-sm"
        >
          <option>Choose an option</option>
          {question.settings.options.map((o) => (
            <option key={o.id}>{o.label}</option>
          ))}
        </select>
      );
    case "yes_no":
      return (
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled>
            {question.settings.yesLabel || "Yes"}
          </Button>
          <Button type="button" variant="outline" disabled>
            {question.settings.noLabel || "No"}
          </Button>
        </div>
      );
    case "rating":
      return (
        <div className="flex gap-1">
          {Array.from({ length: question.settings.scale }, (_, i) => (
            <Star key={i} className="text-muted-foreground size-5" />
          ))}
        </div>
      );
    case "opinion_scale":
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs">
            {question.settings.leftLabel}
          </span>
          {Array.from(
            { length: question.settings.max - question.settings.min + 1 },
            (_, i) => question.settings.min + i,
          ).map((n) => (
            <div
              key={n}
              className="border-input flex size-7 items-center justify-center rounded border text-xs"
            >
              {n}
            </div>
          ))}
          <span className="text-muted-foreground text-xs">
            {question.settings.rightLabel}
          </span>
        </div>
      );
    case "file_upload":
      return (
        <div className="border-input flex items-center gap-2 rounded-md border border-dashed px-4 py-6 text-sm">
          <Upload className="text-muted-foreground size-4" />
          <span className="text-muted-foreground">
            Up to {question.settings.maxSizeMb}MB ·{" "}
            {question.settings.acceptedMimeTypes.join(", ")}
          </span>
        </div>
      );
  }
}
