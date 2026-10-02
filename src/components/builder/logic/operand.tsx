"use client";

import { ArrowLeftRight, X } from "lucide-react";
import type { CompareOperator, Expr, Value } from "@/domains/forms/schema/logic-model";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { CONTACT_FIELD_LABELS } from "@/domains/forms/schema/question-types";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "cn";
import { exprKind, numberedQuestions } from "./logic-ui";

/** Encodes an operand for a Select value. */
export function operandKey(expr: Expr | undefined): string {
  if (!expr) return "";
  if (expr.type === "answer")
    return `a:${expr.questionId}${expr.field ? `:${expr.field}` : ""}`;
  if (expr.type === "variable") return `v:${expr.variableId}`;
  if (expr.type === "hidden") return `h:${expr.name}`;
  return "";
}

export function operandFromKey(key: string): Expr | undefined {
  const [kind, a, b] = key.split(":");
  if (kind === "a" && a) return { type: "answer", questionId: a, field: b || undefined };
  if (kind === "v" && a) return { type: "variable", variableId: a };
  if (kind === "h" && a) return { type: "hidden", name: a };
  return undefined;
}

const TRIGGER = "h-[34px] w-auto min-w-[150px] max-w-[260px] text-[13.5px]";

/** Pick a question (or contact field), a variable or a URL field. */
export function OperandSelect({
  schema,
  value,
  onChange,
  placeholder = "Choose…",
  label,
  excludeQuestionId,
}: {
  schema: FormSchemaV1;
  value: Expr | undefined;
  onChange: (expr: Expr) => void;
  placeholder?: string;
  label: string;
  excludeQuestionId?: string;
}) {
  const questions = numberedQuestions(schema).filter(
    ({ question: q }) =>
      q.id !== excludeQuestionId && q.type !== "welcome_screen" && q.type !== "statement",
  );
  const variables = schema.variables ?? [];
  const hidden = schema.hiddenFields ?? [];
  return (
    <Select value={operandKey(value)} onValueChange={(k) => onChange(operandFromKey(k)!)}>
      <SelectTrigger size="sm" className={TRIGGER} aria-label={label}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-80">
        {questions.length > 0 && (
          <SelectGroup>
            <SelectLabel>Questions</SelectLabel>
            {questions.flatMap(({ question: q, number }) => {
              const name = `${number} · ${q.label.trim() || "Untitled question"}`;
              if (q.type === "contact_info") {
                return q.settings.fields.map((f) => (
                  <SelectItem key={`${q.id}:${f}`} value={`a:${q.id}:${f}`}>
                    {name} · {CONTACT_FIELD_LABELS[f]}
                  </SelectItem>
                ));
              }
              return [
                <SelectItem key={q.id} value={`a:${q.id}`}>
                  {name}
                </SelectItem>,
              ];
            })}
          </SelectGroup>
        )}
        {variables.length > 0 && (
          <SelectGroup>
            <SelectLabel>Variables</SelectLabel>
            {variables.map((v) => (
              <SelectItem key={v.id} value={`v:${v.id}`}>
                <span className="font-mono">{v.name}</span>
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {hidden.length > 0 && (
          <SelectGroup>
            <SelectLabel>URL fields</SelectLabel>
            {hidden.map((h) => (
              <SelectItem key={h.name} value={`h:${h.name}`}>
                <span className="font-mono">{h.name}</span>
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}

const MULTI_OPS = new Set<CompareOperator>(["any_of", "all_of", "none_of"]);

/** A sensible field to compare against: another answer of the same kind,
 * else any variable, else the left side itself. */
function otherOperand(schema: FormSchemaV1, left: Expr): Expr {
  const kind = exprKind(left, schema);
  const sameKind = numberedQuestions(schema).find(
    ({ question: q }) =>
      (left.type !== "answer" || q.id !== left.questionId) &&
      exprKind({ type: "answer", questionId: q.id }, schema) === kind,
  );
  if (sameKind) return { type: "answer", questionId: sameKind.question.id };
  const variable = (schema.variables ?? [])[0];
  return variable ? { type: "variable", variableId: variable.id } : left;
}

/**
 * The right-hand side of a comparison, shaped by the left side: option
 * pickers for choices, Yes/No, number or date inputs, text — or, with the
 * ⇄ toggle, another question / variable (cross-field comparison).
 */
export function ValueInput({
  schema,
  left,
  op,
  value,
  onChange,
  label,
}: {
  schema: FormSchemaV1;
  left: Expr;
  op: CompareOperator;
  value: Expr | undefined;
  onChange: (expr: Expr) => void;
  label: string;
}) {
  const kind = exprKind(left, schema);
  const isField = value !== undefined && value.type !== "literal";
  const literal: Value = value?.type === "literal" ? value.value : null;
  const set = (v: Value) => onChange({ type: "literal", value: v });

  const toggle = (
    <button
      type="button"
      title={
        isField ? "Compare with a fixed value" : "Compare with another answer or variable"
      }
      aria-label={
        isField ? "Compare with a fixed value" : "Compare with another answer or variable"
      }
      aria-pressed={isField}
      onClick={() =>
        isField ? set(kind === "number" ? 0 : "") : onChange(otherOperand(schema, left))
      }
      className={cn(
        "fc-focus grid size-[34px] shrink-0 place-items-center rounded-sm border-[1.5px]",
        isField ? "border-ink bg-accent" : "border-input hover:bg-hover-wash",
      )}
    >
      <ArrowLeftRight className="size-3.5" />
    </button>
  );

  if (isField) {
    return (
      <span className="flex items-center gap-1.5">
        <OperandSelect
          schema={schema}
          value={value}
          onChange={onChange}
          label={`${label}: compare with`}
          placeholder="Another answer…"
        />
        {toggle}
      </span>
    );
  }

  let control: React.ReactNode;
  const question =
    left.type === "answer"
      ? schema.questions.find((q) => q.id === left.questionId)
      : undefined;
  const options = (question?.settings as { options?: { id: string; label: string }[] })
    ?.options;

  if ((kind === "choice" || kind === "multi") && options) {
    if (MULTI_OPS.has(op)) {
      const chosen = Array.isArray(literal) ? literal.map(String) : [];
      control = (
        <span
          className="flex max-w-[360px] flex-wrap gap-1"
          role="group"
          aria-label={label}
        >
          {options.map((o) => {
            const on = chosen.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  set(on ? chosen.filter((c) => c !== o.id) : [...chosen, o.id])
                }
                className={cn(
                  "fc-focus h-[30px] max-w-40 truncate rounded-full border-[1.5px] px-2.5 text-[12.5px] font-semibold",
                  on ? "border-ink bg-accent" : "border-input bg-card",
                )}
              >
                {o.label || "Untitled option"}
              </button>
            );
          })}
        </span>
      );
    } else {
      control = (
        <Select value={typeof literal === "string" ? literal : ""} onValueChange={set}>
          <SelectTrigger size="sm" className={TRIGGER} aria-label={label}>
            <SelectValue placeholder="Choose option" />
          </SelectTrigger>
          <SelectContent position="popper">
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label || "Untitled option"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
  } else if (kind === "yes_no") {
    const s = (question?.settings ?? {}) as { yesLabel?: string; noLabel?: string };
    control = (
      <Select
        value={literal === true ? "yes" : literal === false ? "no" : ""}
        onValueChange={(v) => set(v === "yes")}
      >
        <SelectTrigger size="sm" className={TRIGGER} aria-label={label}>
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value="yes">{s.yesLabel || "Yes"}</SelectItem>
          <SelectItem value="no">{s.noLabel || "No"}</SelectItem>
        </SelectContent>
      </Select>
    );
  } else if (kind === "number") {
    control = (
      <Input
        type="number"
        aria-label={label}
        value={typeof literal === "number" ? literal : ""}
        onChange={(e) => set(e.target.value === "" ? null : Number(e.target.value))}
        className="h-[34px] w-28 px-2.5 text-sm"
      />
    );
  } else if (kind === "date") {
    control = (
      <Input
        type="date"
        aria-label={label}
        value={typeof literal === "string" ? literal : ""}
        onChange={(e) => set(e.target.value)}
        className="h-[34px] w-40 px-2.5 text-sm"
      />
    );
  } else {
    control = (
      <Input
        aria-label={label}
        value={
          typeof literal === "string" ? literal : literal === null ? "" : String(literal)
        }
        onChange={(e) => set(e.target.value)}
        placeholder="Value"
        className="h-[34px] w-44 px-2.5 text-sm"
      />
    );
  }

  return (
    <span className="flex items-center gap-1.5">
      {control}
      {!MULTI_OPS.has(op) && kind !== "choice" && kind !== "multi" && toggle}
    </span>
  );
}

export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="fc-focus text-muted-foreground hover:text-destructive grid size-[30px] shrink-0 place-items-center rounded-sm hover:bg-[var(--alert-error-bg)]"
    >
      <X className="size-3.5" />
    </button>
  );
}
