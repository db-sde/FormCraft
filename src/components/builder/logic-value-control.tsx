"use client";

import type { QuestionV1 } from "@/domains/forms/schema/v1";
import type { LogicOperator } from "@/domains/forms/schema/question-types";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** The value editor for a logic rule's right-hand side, shaped by the
 * source question's type so the creator picks from real options
 * instead of typing a raw id/string that has to match exactly. */
export function LogicValueControl({
  question,
  operator,
  value,
  onChange,
}: {
  question: QuestionV1 | undefined;
  operator: LogicOperator;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (operator === "is_answered" || operator === "is_not_answered" || !question) {
    return null;
  }

  if (
    question.type === "single_select" ||
    question.type === "multi_select" ||
    question.type === "dropdown"
  ) {
    return (
      <Select value={typeof value === "string" ? value : ""} onValueChange={onChange}>
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Choose option" />
        </SelectTrigger>
        <SelectContent>
          {question.settings.options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (question.type === "yes_no") {
    return (
      <Select
        value={value === true ? "yes" : value === false ? "no" : ""}
        onValueChange={(v) => onChange(v === "yes")}
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="yes">{question.settings.yesLabel || "Yes"}</SelectItem>
          <SelectItem value="no">{question.settings.noLabel || "No"}</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (
    question.type === "number" ||
    question.type === "rating" ||
    question.type === "opinion_scale"
  ) {
    return (
      <Input
        type="number"
        value={typeof value === "number" ? value : ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? undefined : Number(e.target.value))
        }
        className="w-28"
        aria-label="Comparison value"
      />
    );
  }

  return (
    <Input
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Value"
      className="w-40"
      aria-label="Comparison value"
    />
  );
}
