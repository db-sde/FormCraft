"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type {
  ActionV1,
  Expr,
  RuleV1,
  VariableOperation,
} from "@/domains/forms/schema/logic-model";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { parseFormula, printFormula } from "@/domains/logic/formula";
import { questionsAfter } from "@/domains/forms/builder";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "cn";
import { numberedQuestions } from "./logic-ui";
import { RemoveButton } from "./operand";

const TRIGGER = "h-[34px] w-auto min-w-[140px] max-w-[260px] text-[13.5px]";

/** A formula field: `q2 * price + 10`. Keeps what's typed, commits only
 * what parses, and says what's wrong otherwise. */
export function FormulaInput({
  schema,
  value,
  onChange,
  label,
  className,
}: {
  schema: FormSchemaV1;
  value: Expr;
  onChange: (expr: Expr) => void;
  label: string;
  className?: string;
}) {
  const printed = printFormula(value, schema);
  const [text, setText] = useState(printed);
  const [lastPrinted, setLastPrinted] = useState(printed);
  const [error, setError] = useState<string | null>(null);
  // An outside change (undo, a renamed variable) replaces the text.
  if (printed !== lastPrinted) {
    setLastPrinted(printed);
    setText(printed);
    setError(null);
  }

  return (
    <span className={cn("flex min-w-0 flex-col gap-1", className)}>
      <Input
        aria-label={label}
        aria-invalid={!!error}
        value={text}
        spellCheck={false}
        placeholder="e.g. q2 * price + 10"
        onChange={(e) => {
          setText(e.target.value);
          const parsed = parseFormula(e.target.value, schema);
          if (parsed.ok) {
            setError(null);
            const next = printFormula(parsed.expr, schema);
            setLastPrinted(next);
            onChange(parsed.expr);
          } else {
            setError(parsed.message);
          }
        }}
        className={cn(
          "h-[34px] min-w-44 px-2.5 font-mono text-[13px]",
          error && "border-destructive",
        )}
      />
      {error && <span className="text-destructive text-xs">{error}</span>}
    </span>
  );
}

const OPS: { value: VariableOperation; label: string; for: string[] }[] = [
  { value: "set", label: "set to", for: ["number", "string", "boolean", "date", "list"] },
  { value: "add", label: "add", for: ["number", "string"] },
  { value: "subtract", label: "subtract", for: ["number"] },
  { value: "multiply", label: "multiply by", for: ["number"] },
  { value: "divide", label: "divide by", for: ["number"] },
  { value: "append", label: "add to list", for: ["list"] },
  { value: "remove", label: "remove from list", for: ["list"] },
];

type ActionKind = ActionV1["type"];

const KIND_LABEL: Record<ActionKind, string> = {
  jump_to_question: "Go to question",
  jump_to_ending: "End with",
  set_variable: "Set variable",
  go_to_highest: "Show top outcome",
};

function newAction(
  kind: ActionKind,
  schema: FormSchemaV1,
  rule: RuleV1,
): ActionV1 | null {
  switch (kind) {
    case "jump_to_question": {
      const target =
        rule.on.event === "question_answered"
          ? questionsAfter(schema.questions, rule.on.questionId)[0]
          : undefined;
      return target ? { type: "jump_to_question", questionId: target.id } : null;
    }
    case "jump_to_ending":
      return { type: "jump_to_ending", endingId: schema.endings[0].id };
    case "set_variable": {
      const v = (schema.variables ?? [])[0];
      return v
        ? {
            type: "set_variable",
            variableId: v.id,
            op: v.type === "number" ? "add" : "set",
            value: { type: "literal", value: v.type === "number" ? 1 : "" },
          }
        : null;
    }
    case "go_to_highest": {
      const numbers = (schema.variables ?? []).filter((v) => v.type === "number");
      return numbers.length
        ? {
            type: "go_to_highest",
            candidates: numbers.slice(0, schema.endings.length).map((v, i) => ({
              variableId: v.id,
              endingId: schema.endings[Math.min(i, schema.endings.length - 1)].id,
            })),
          }
        : null;
    }
  }
}

export function ActionsEditor({
  schema,
  rule,
  onChange,
}: {
  schema: FormSchemaV1;
  rule: RuleV1;
  onChange: (actions: ActionV1[]) => void;
}) {
  const actions = rule.then;
  const update = (i: number, next: ActionV1 | null) =>
    onChange(
      next === null
        ? actions.filter((_, j) => j !== i)
        : actions.map((a, j) => (j === i ? next : a)),
    );
  const available = (Object.keys(KIND_LABEL) as ActionKind[]).filter(
    (k) => newAction(k, schema, rule) !== null,
  );

  return (
    <div className="flex flex-col gap-2">
      {actions.map((action, i) => (
        <div key={i} className="flex flex-wrap items-start gap-1.5">
          <Select
            value={action.type}
            onValueChange={(k) => {
              const next = newAction(k as ActionKind, schema, rule);
              if (next) update(i, next);
            }}
          >
            <SelectTrigger size="sm" className={TRIGGER} aria-label={`Action ${i + 1}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {available.map((k) => (
                <SelectItem key={k} value={k}>
                  {KIND_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ActionFields
            schema={schema}
            rule={rule}
            action={action}
            onChange={(a) => update(i, a)}
            index={i}
          />
          {actions.length > 1 && (
            <RemoveButton
              label={`Remove action ${i + 1}`}
              onClick={() => update(i, null)}
            />
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          const kind = available.find((k) => k === "set_variable") ?? available[0];
          const next = kind && newAction(kind, schema, rule);
          if (next) onChange([...actions, next]);
        }}
        className="fc-focus text-muted-foreground hover:text-foreground hover:bg-hover-wash flex h-7 items-center gap-1 self-start rounded-sm px-1.5 text-[13px] font-semibold"
      >
        <Plus className="size-3.5" /> Action
      </button>
    </div>
  );
}

function ActionFields({
  schema,
  rule,
  action,
  onChange,
  index,
}: {
  schema: FormSchemaV1;
  rule: RuleV1;
  action: ActionV1;
  onChange: (next: ActionV1) => void;
  index: number;
}) {
  const label = `Action ${index + 1}`;
  if (action.type === "jump_to_question") {
    const targets =
      rule.on.event === "question_answered"
        ? questionsAfter(schema.questions, rule.on.questionId)
        : [];
    const numbers = new Map(
      numberedQuestions(schema).map((e) => [e.question.id, e.number]),
    );
    return (
      <Select
        value={action.questionId}
        onValueChange={(questionId) => onChange({ ...action, questionId })}
      >
        <SelectTrigger size="sm" className={TRIGGER} aria-label={`${label}: question`}>
          <SelectValue placeholder="Choose question" />
        </SelectTrigger>
        <SelectContent position="popper">
          {targets.map((q) => (
            <SelectItem key={q.id} value={q.id}>
              {numbers.get(q.id)} · {q.label.trim() || "Untitled question"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (action.type === "jump_to_ending") {
    return (
      <Select
        value={action.endingId}
        onValueChange={(endingId) => onChange({ ...action, endingId })}
      >
        <SelectTrigger size="sm" className={TRIGGER} aria-label={`${label}: ending`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {schema.endings.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.title.trim() || "Untitled ending"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (action.type === "set_variable") {
    const variable = (schema.variables ?? []).find((v) => v.id === action.variableId);
    const ops = OPS.filter((o) => !variable || o.for.includes(variable.type));
    return (
      <>
        <Select
          value={action.variableId}
          onValueChange={(variableId) => onChange({ ...action, variableId })}
        >
          <SelectTrigger
            size="sm"
            className={cn(TRIGGER, "min-w-28 font-mono")}
            aria-label={`${label}: variable`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {(schema.variables ?? []).map((v) => (
              <SelectItem key={v.id} value={v.id}>
                <span className="font-mono">{v.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={action.op}
          onValueChange={(op) => onChange({ ...action, op: op as VariableOperation })}
        >
          <SelectTrigger
            size="sm"
            className={cn(TRIGGER, "min-w-28")}
            aria-label={`${label}: operation`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {ops.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FormulaInput
          schema={schema}
          value={action.value}
          onChange={(value) => onChange({ ...action, value })}
          label={`${label}: value`}
        />
      </>
    );
  }
  // go_to_highest: pair each score with an ending; order = tie priority.
  const numbers = (schema.variables ?? []).filter((v) => v.type === "number");
  return (
    <div className="flex flex-col gap-1.5">
      {action.candidates.map((c, i) => (
        <span key={i} className="flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="text-muted-foreground w-[52px]">
            {i === 0 ? "Highest" : "then"}
          </span>
          <Select
            value={c.variableId}
            onValueChange={(variableId) =>
              onChange({
                ...action,
                candidates: action.candidates.map((x, j) =>
                  j === i ? { ...x, variableId } : x,
                ),
              })
            }
          >
            <SelectTrigger
              size="sm"
              className={cn(TRIGGER, "min-w-28 font-mono")}
              aria-label={`${label}: score ${i + 1}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {numbers.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  <span className="font-mono">{v.name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-muted-foreground">→</span>
          <Select
            value={c.endingId}
            onValueChange={(endingId) =>
              onChange({
                ...action,
                candidates: action.candidates.map((x, j) =>
                  j === i ? { ...x, endingId } : x,
                ),
              })
            }
          >
            <SelectTrigger
              size="sm"
              className={TRIGGER}
              aria-label={`${label}: ending ${i + 1}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {schema.endings.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.title.trim() || "Untitled ending"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {action.candidates.length > 1 && (
            <RemoveButton
              label={`Remove outcome ${i + 1}`}
              onClick={() =>
                onChange({
                  ...action,
                  candidates: action.candidates.filter((_, j) => j !== i),
                })
              }
            />
          )}
        </span>
      ))}
      {numbers.length > action.candidates.length && (
        <button
          type="button"
          onClick={() => {
            const unused = numbers.find(
              (v) => !action.candidates.some((c) => c.variableId === v.id),
            );
            if (unused) {
              onChange({
                ...action,
                candidates: [
                  ...action.candidates,
                  { variableId: unused.id, endingId: schema.endings[0].id },
                ],
              });
            }
          }}
          className="fc-focus text-muted-foreground hover:text-foreground hover:bg-hover-wash flex h-7 items-center gap-1 self-start rounded-sm px-1.5 text-[13px] font-semibold"
        >
          <Plus className="size-3.5" /> Outcome
        </button>
      )}
      <span className="text-muted-foreground text-xs">
        Ties go to the outcome listed first.
      </span>
    </div>
  );
}
