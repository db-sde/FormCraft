"use client";

import { Plus } from "lucide-react";
import type {
  CompareOperator,
  Condition,
  Expr,
} from "@/domains/forms/schema/logic-model";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "cn";
import {
  OPERATOR_LABEL,
  defaultCompare,
  defaultValue,
  exprKind,
  numberedQuestions,
  operatorsFor,
} from "./logic-ui";
import { OperandSelect, RemoveButton, ValueInput } from "./operand";

type Group = Extract<Condition, { type: "all" | "any" }>;
type Compare = Extract<Condition, { type: "compare" }>;

/** Edits are always on a group; a single comparison is a group of one. */
function asGroup(condition: Condition | undefined): Group {
  if (!condition) return { type: "all", conditions: [] };
  if (condition.type === "all" || condition.type === "any") return condition;
  return { type: "all", conditions: [condition] };
}

/** The first thing worth comparing, so "+ Condition" is never blank. */
function firstOperand(
  schema: FormSchemaV1,
  preferred?: Expr,
  exclude?: string,
): Expr | null {
  if (preferred) return preferred;
  const q = numberedQuestions(schema).find(
    ({ question }) =>
      question.id !== exclude &&
      question.type !== "welcome_screen" &&
      question.type !== "statement",
  );
  if (q) return { type: "answer", questionId: q.question.id };
  const v = (schema.variables ?? [])[0];
  if (v) return { type: "variable", variableId: v.id };
  const h = (schema.hiddenFields ?? [])[0];
  return h ? { type: "hidden", name: h.name } : null;
}

/**
 * Builds conditions without exposing the AST: one row reads as a
 * sentence ("Company size is greater than 100"); add rows and choose
 * All / Any; add a group for "(A or B) and C". One level of nesting
 * covers real forms without turning into a tree editor.
 */
export function ConditionEditor({
  schema,
  value,
  onChange,
  preferredLeft,
  excludeQuestionId,
  label,
}: {
  schema: FormSchemaV1;
  value: Condition | undefined;
  onChange: (next: Condition | undefined) => void;
  /** What new rows compare by default (e.g. the rule's question). */
  preferredLeft?: Expr;
  /** A question that can't be used (e.g. its own show condition). */
  excludeQuestionId?: string;
  label: string;
}) {
  return (
    <GroupEditor
      schema={schema}
      group={asGroup(value)}
      depth={0}
      onChange={(g) => onChange(g.conditions.length === 0 ? undefined : g)}
      preferredLeft={preferredLeft}
      excludeQuestionId={excludeQuestionId}
      label={label}
    />
  );
}

function GroupEditor({
  schema,
  group,
  depth,
  onChange,
  onRemove,
  preferredLeft,
  excludeQuestionId,
  label,
}: {
  schema: FormSchemaV1;
  group: Group;
  depth: number;
  onChange: (next: Group) => void;
  onRemove?: () => void;
  preferredLeft?: Expr;
  excludeQuestionId?: string;
  label: string;
}) {
  const operand = firstOperand(schema, preferredLeft, excludeQuestionId);
  const update = (index: number, next: Condition | null) =>
    onChange({
      ...group,
      conditions:
        next === null
          ? group.conditions.filter((_, i) => i !== index)
          : group.conditions.map((c, i) => (i === index ? next : c)),
    });

  return (
    <div
      className={cn(
        "flex flex-col gap-2",
        depth > 0 &&
          "border-input bg-background rounded-sm border-[1.5px] border-dashed p-2.5",
      )}
    >
      {(group.conditions.length > 1 || depth > 0) && (
        <div className="flex items-center gap-2 text-[13px]">
          <div
            role="radiogroup"
            aria-label={`${label}: match`}
            className="border-input bg-card flex gap-0.5 rounded-[7px] border-[1.5px] p-[2px]"
          >
            {(["all", "any"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={group.type === mode}
                onClick={() => onChange({ ...group, type: mode })}
                className={cn(
                  "fc-focus rounded-[5px] px-2.5 py-[3px] text-[12.5px] font-semibold",
                  group.type === mode
                    ? "bg-secondary text-secondary-foreground"
                    : "hover:bg-hover-wash",
                )}
              >
                {mode === "all" ? "All" : "Any"}
              </button>
            ))}
          </div>
          <span className="text-muted-foreground">of these are true</span>
          <span className="flex-1" />
          {onRemove && <RemoveButton label="Remove group" onClick={onRemove} />}
        </div>
      )}

      {group.conditions.map((condition, index) =>
        condition.type === "compare" ? (
          <CompareRow
            key={index}
            schema={schema}
            condition={condition}
            onChange={(next) => update(index, next)}
            onRemove={() => update(index, null)}
            excludeQuestionId={excludeQuestionId}
            label={`${label}, condition ${index + 1}`}
          />
        ) : (
          <GroupEditor
            key={index}
            schema={schema}
            group={asGroup(condition)}
            depth={depth + 1}
            onChange={(next) => update(index, next.conditions.length === 0 ? null : next)}
            onRemove={() => update(index, null)}
            preferredLeft={preferredLeft}
            excludeQuestionId={excludeQuestionId}
            label={`${label}, group ${index + 1}`}
          />
        ),
      )}

      {operand ? (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() =>
              onChange({
                ...group,
                conditions: [...group.conditions, defaultCompare(operand, schema)],
              })
            }
            className="fc-focus text-muted-foreground hover:text-foreground hover:bg-hover-wash flex h-7 items-center gap-1 rounded-sm px-1.5 text-[13px] font-semibold"
          >
            <Plus className="size-3.5" /> Condition
          </button>
          {depth === 0 && group.conditions.length > 0 && (
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...group,
                  conditions: [
                    ...group.conditions,
                    {
                      type: group.type === "all" ? "any" : "all",
                      conditions: [defaultCompare(operand, schema)],
                    },
                  ],
                })
              }
              className="fc-focus text-muted-foreground hover:text-foreground hover:bg-hover-wash flex h-7 items-center gap-1 rounded-sm px-1.5 text-[13px] font-semibold"
            >
              <Plus className="size-3.5" /> Group
            </button>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground text-[13px]">
          Add a question or a variable first, then you can check it here.
        </p>
      )}
    </div>
  );
}

function CompareRow({
  schema,
  condition,
  onChange,
  onRemove,
  excludeQuestionId,
  label,
}: {
  schema: FormSchemaV1;
  condition: Compare;
  onChange: (next: Compare) => void;
  onRemove: () => void;
  excludeQuestionId?: string;
  label: string;
}) {
  const kind = exprKind(condition.left, schema);
  const ops = operatorsFor(kind);
  const op = ops.includes(condition.op) ? condition.op : ops[0];
  const needsValue = defaultValue(condition.left, op, schema) !== undefined;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <OperandSelect
        schema={schema}
        value={condition.left}
        excludeQuestionId={excludeQuestionId}
        label={`${label}: what to check`}
        onChange={(left) => {
          const fresh = defaultCompare(left, schema) as Compare;
          onChange(fresh);
        }}
      />
      <Select
        value={op}
        onValueChange={(next) => {
          const nextOp = next as CompareOperator;
          const right = defaultValue(condition.left, nextOp, schema);
          // Keep a value that still fits (e.g. "is" → "is not").
          const keep =
            right !== undefined &&
            condition.right !== undefined &&
            Array.isArray((right as { value?: unknown }).value) ===
              Array.isArray((condition.right as { value?: unknown }).value);
          onChange({
            ...condition,
            op: nextOp,
            right: keep ? condition.right : right,
            right2:
              nextOp === "between" || nextOp === "not_between"
                ? (condition.right2 ?? right)
                : undefined,
          });
        }}
      >
        <SelectTrigger
          size="sm"
          className="h-[34px] w-auto min-w-[120px] text-[13.5px]"
          aria-label={`${label}: how`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {ops.map((o) => (
            <SelectItem key={o} value={o}>
              {OPERATOR_LABEL[o]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {needsValue && (
        <ValueInput
          schema={schema}
          left={condition.left}
          op={op}
          value={condition.right}
          onChange={(right) => onChange({ ...condition, op, right })}
          label={`${label}: value`}
        />
      )}
      {(op === "between" || op === "not_between") && (
        <>
          <span className="text-muted-foreground text-[13px]">and</span>
          <ValueInput
            schema={schema}
            left={condition.left}
            op={op}
            value={condition.right2}
            onChange={(right2) => onChange({ ...condition, op, right2 })}
            label={`${label}: highest value`}
          />
        </>
      )}
      <RemoveButton label={`Remove ${label}`} onClick={onRemove} />
    </div>
  );
}
