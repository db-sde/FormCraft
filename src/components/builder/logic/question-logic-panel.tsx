"use client";

import { useState } from "react";
import { Check, Eye, Plus, ShieldCheck, Trophy } from "lucide-react";
import { nanoid } from "nanoid";
import type { Condition, QuestionValidationV1 } from "@/domains/forms/schema/logic-model";
import type { FormSchemaV1, QuestionV1 } from "@/domains/forms/schema/v1";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "cn";
import { SectionHead } from "../panel-ui";
import { ConditionEditor } from "./condition-editor";
import { describeCondition, defaultCompare } from "./logic-ui";
import { RemoveButton } from "./operand";

/** A condition summarised in words, edited in a roomy dialog. */
function ConditionField({
  schema,
  value,
  onChange,
  title,
  description,
  excludeQuestionId,
  preferredLeft,
  emptyLabel,
}: {
  schema: FormSchemaV1;
  value: Condition | undefined;
  onChange: (next: Condition | undefined) => void;
  title: string;
  description: string;
  excludeQuestionId?: string;
  preferredLeft?: { type: "answer"; questionId: string };
  emptyLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Condition | undefined>(value);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDraft(value);
          setOpen(true);
        }}
        className="fc-focus border-input bg-field hover:border-ink w-full rounded-sm border-[1.5px] px-2.5 py-2 text-left text-[13px] leading-snug"
      >
        {value ? (
          describeCondition(value, schema)
        ) : (
          <span className="text-muted-foreground">{emptyLabel}</span>
        )}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[680px]">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <ConditionEditor
            schema={schema}
            value={draft}
            onChange={setDraft}
            excludeQuestionId={excludeQuestionId}
            preferredLeft={preferredLeft}
            label={title}
          />
          {draft && (
            <p className="bg-background text-muted-foreground rounded-sm px-3 py-2 text-[13px]">
              Reads as: {describeCondition(draft, schema)}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                onChange(draft);
                setOpen(false);
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A first show condition: an earlier answer, else a variable or URL field. */
function showSeed(
  schema: FormSchemaV1,
  earlierId: string | undefined,
): Condition | undefined {
  if (earlierId) return defaultCompare({ type: "answer", questionId: earlierId }, schema);
  const hidden = (schema.hiddenFields ?? [])[0];
  if (hidden) return defaultCompare({ type: "hidden", name: hidden.name }, schema);
  const variable = (schema.variables ?? [])[0];
  return variable
    ? defaultCompare({ type: "variable", variableId: variable.id }, schema)
    : undefined;
}

/** First question before this one with an answer (for show conditions). */
function earlierQuestion(schema: FormSchemaV1, question: QuestionV1) {
  const ordered = [...schema.questions].sort((a, b) => a.order - b.order);
  return ordered
    .slice(
      0,
      ordered.findIndex((q) => q.id === question.id),
    )
    .reverse()
    .find((q) => q.type !== "welcome_screen" && q.type !== "statement");
}

/**
 * The logic that belongs to one question (Part 4 right panel): when it's
 * shown, what its answer must satisfy, and — for choices — how many
 * points each option scores. All of it is plain schema the engine reads.
 */
export function QuestionLogicPanel({
  schema,
  question,
  onChange,
  onSchemaChange,
}: {
  schema: FormSchemaV1;
  question: QuestionV1;
  onChange: (next: QuestionV1) => void;
  onSchemaChange: (patch: Partial<FormSchemaV1>) => void;
}) {
  if (question.type === "welcome_screen") return null;
  const answerable = question.type !== "statement";
  const earlier = earlierQuestion(schema, question);
  const showable =
    !!earlier ||
    (schema.variables ?? []).length > 0 ||
    (schema.hiddenFields ?? []).length > 0;

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-4">
      <SectionHead>Logic</SectionHead>

      <div className="col-span-full flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-[13.5px] font-semibold">
          <Eye className="size-3.5" /> Show this question
        </span>
        {showable ? (
          <>
            <div className="border-input bg-background flex gap-0.5 self-start rounded-[7px] border-[1.5px] p-[2px]">
              {(["always", "when"] as const).map((mode) => {
                const active =
                  mode === "always" ? !question.visibleIf : !!question.visibleIf;
                return (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      onChange({
                        ...question,
                        visibleIf:
                          mode === "always"
                            ? undefined
                            : (question.visibleIf ?? showSeed(schema, earlier?.id)),
                      } as QuestionV1)
                    }
                    className={cn(
                      "fc-focus rounded-[5px] px-2.5 py-[3px] text-[12.5px] font-semibold",
                      active
                        ? "bg-secondary text-secondary-foreground"
                        : "hover:bg-hover-wash",
                    )}
                  >
                    {mode === "always" ? "Always" : "Only when…"}
                  </button>
                );
              })}
            </div>
            {question.visibleIf && (
              <ConditionField
                schema={schema}
                value={question.visibleIf}
                onChange={(visibleIf) =>
                  onChange({ ...question, visibleIf } as QuestionV1)
                }
                title="Show this question only when…"
                description="When this isn't true it's skipped: not shown, not required and not saved."
                excludeQuestionId={question.id}
                preferredLeft={
                  earlier ? { type: "answer", questionId: earlier.id } : undefined
                }
                emptyLabel="Choose when to show it"
              />
            )}
          </>
        ) : (
          <span className="text-muted-foreground text-xs">
            Add a question before this one to show it based on an answer.
          </span>
        )}
      </div>

      {answerable && question.type !== "contact_info" && (
        <ChecksEditor schema={schema} question={question} onChange={onChange} />
      )}

      {(question.type === "single_select" ||
        question.type === "multi_select" ||
        question.type === "dropdown") && (
        <ScoringEditor
          schema={schema}
          question={question}
          onChange={onChange}
          onSchemaChange={onSchemaChange}
        />
      )}
    </div>
  );
}

function ChecksEditor({
  schema,
  question,
  onChange,
}: {
  schema: FormSchemaV1;
  question: QuestionV1;
  onChange: (next: QuestionV1) => void;
}) {
  const checks = question.validations ?? [];
  const self = { type: "answer" as const, questionId: question.id };
  const set = (next: QuestionValidationV1[]) =>
    onChange({ ...question, validations: next.length ? next : undefined } as QuestionV1);

  return (
    <div className="col-span-full flex flex-col gap-2">
      <span className="flex items-center gap-1.5 text-[13.5px] font-semibold">
        <ShieldCheck className="size-3.5" /> Checks
      </span>
      {checks.map((check, i) => (
        <div
          key={check.id}
          className="border-border bg-background flex flex-col gap-1.5 rounded-sm border-[1.5px] p-2.5"
        >
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground flex-1 text-xs font-semibold">
              Check {i + 1}
            </span>
            <RemoveButton
              label={`Remove check ${i + 1}`}
              onClick={() => set(checks.filter((c) => c.id !== check.id))}
            />
          </div>
          <span className="text-xs">Only applies when (optional)</span>
          <ConditionField
            schema={schema}
            value={check.when}
            onChange={(when) =>
              set(checks.map((c) => (c.id === check.id ? { ...c, when } : c)))
            }
            title="Only check when…"
            description="Leave empty to always check, e.g. only when the country is India."
            emptyLabel="Always"
          />
          <span className="text-xs">The answer must satisfy</span>
          <ConditionField
            schema={schema}
            value={check.check}
            onChange={(c) =>
              c && set(checks.map((x) => (x.id === check.id ? { ...x, check: c } : x)))
            }
            title="The answer must satisfy…"
            description="Compare with a value or another answer, e.g. the end date is after the start date."
            preferredLeft={self}
            emptyLabel="Choose a rule"
          />
          <Input
            aria-label={`Check ${i + 1} message`}
            value={check.message}
            maxLength={200}
            placeholder="Message to show"
            onChange={(e) =>
              set(
                checks.map((c) =>
                  c.id === check.id ? { ...c, message: e.target.value } : c,
                ),
              )
            }
            className="h-[34px] px-2.5 text-[13.5px]"
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          set([
            ...checks,
            {
              id: `chk_${nanoid(8)}`,
              check: defaultCompare(self, schema),
              message: "Please check this answer.",
            },
          ])
        }
        className="fc-focus border-ink hover:bg-hover-wash flex h-8 items-center gap-1.5 self-start rounded-sm border-[1.5px] border-dashed px-2.5 text-[13px] font-semibold"
      >
        <Plus className="size-[13px]" /> Add check
      </button>
    </div>
  );
}

type ChoiceQuestion = Extract<
  QuestionV1,
  { type: "single_select" | "multi_select" | "dropdown" }
>;

function ScoringEditor({
  schema,
  question,
  onChange,
  onSchemaChange,
}: {
  schema: FormSchemaV1;
  question: ChoiceQuestion;
  onChange: (next: QuestionV1) => void;
  onSchemaChange: (patch: Partial<FormSchemaV1>) => void;
}) {
  const numbers = (schema.variables ?? []).filter((v) => v.type === "number");
  const options = question.settings.options;
  // Score columns: any number variable an option already scores into,
  // else the first one.
  const used = numbers.filter((v) =>
    options.some((o) => o.scores?.some((s) => s.variableId === v.id)),
  );
  const [extra, setExtra] = useState<string[]>([]);
  const columns = [
    ...used,
    ...numbers.filter((v) => !used.includes(v) && extra.includes(v.id)),
  ];
  if (columns.length === 0 && numbers[0]) columns.push(numbers[0]);

  const setOptions = (next: typeof options) =>
    onChange({
      ...question,
      settings: { ...question.settings, options: next },
    } as QuestionV1);

  if (numbers.length === 0) {
    return (
      <div className="col-span-full flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-[13.5px] font-semibold">
          <Trophy className="size-3.5" /> Scoring
        </span>
        <span className="text-muted-foreground text-xs">
          Give options points for quizzes, assessments and lead scores.
        </span>
        <button
          type="button"
          onClick={() =>
            onSchemaChange({
              variables: [
                ...(schema.variables ?? []),
                { id: `var_${nanoid(8)}`, name: "score", type: "number" },
              ],
            })
          }
          className="fc-focus border-ink hover:bg-hover-wash flex h-8 items-center gap-1.5 self-start rounded-sm border-[1.5px] border-dashed px-2.5 text-[13px] font-semibold"
        >
          <Plus className="size-[13px]" /> Create a score
        </button>
      </div>
    );
  }

  return (
    <div className="col-span-full flex flex-col gap-2">
      <span className="flex items-center gap-1.5 text-[13.5px] font-semibold">
        <Trophy className="size-3.5" /> Scoring
      </span>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-muted-foreground text-left text-[11px] font-bold uppercase">
              <th className="pb-1 font-bold">Option</th>
              <th className="w-9 pb-1 text-center font-bold" title="Correct answer">
                ✓
              </th>
              {columns.map((v) => (
                <th key={v.id} className="w-16 pb-1 font-mono font-bold normal-case">
                  {v.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {options.map((option) => (
              <tr key={option.id}>
                <td className="max-w-[90px] truncate py-0.5 pr-1.5">
                  {option.label || "Untitled"}
                </td>
                <td className="text-center">
                  <button
                    type="button"
                    aria-label={`${option.label}: correct answer`}
                    aria-pressed={!!option.correct}
                    onClick={() =>
                      setOptions(
                        options.map((o) =>
                          o.id === option.id
                            ? { ...o, correct: o.correct ? undefined : true }
                            : o,
                        ),
                      )
                    }
                    className={cn(
                      "fc-focus grid size-6 place-items-center rounded-[5px] border-[1.5px]",
                      option.correct
                        ? "border-ink bg-[var(--chip-live-bg)]"
                        : "border-input",
                    )}
                  >
                    {option.correct && <Check className="size-3.5" />}
                  </button>
                </td>
                {columns.map((v) => {
                  const points = option.scores?.find(
                    (s) => s.variableId === v.id,
                  )?.points;
                  return (
                    <td key={v.id} className="py-0.5">
                      <Input
                        type="number"
                        aria-label={`${option.label}: points for ${v.name}`}
                        value={points ?? ""}
                        placeholder="0"
                        onChange={(e) => {
                          const raw = e.target.value;
                          setOptions(
                            options.map((o) => {
                              if (o.id !== option.id) return o;
                              const rest = (o.scores ?? []).filter(
                                (s) => s.variableId !== v.id,
                              );
                              const scores =
                                raw === "" || Number(raw) === 0
                                  ? rest
                                  : [...rest, { variableId: v.id, points: Number(raw) }];
                              return { ...o, scores: scores.length ? scores : undefined };
                            }),
                          );
                        }}
                        className="h-8 w-16 px-1.5 text-[13px]"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {numbers.length > columns.length && (
          <button
            type="button"
            onClick={() => {
              const next = numbers.find((v) => !columns.includes(v));
              if (next) setExtra((e) => [...e, next.id]);
            }}
            className="fc-focus text-muted-foreground hover:text-foreground hover:bg-hover-wash flex h-7 items-center gap-1 rounded-sm px-1.5 text-[13px] font-semibold"
          >
            <Plus className="size-3.5" /> Another score
          </button>
        )}
        <label className="text-muted-foreground ml-auto flex items-center gap-1.5 text-xs">
          Weight ×
          <Input
            type="number"
            min={0}
            step="0.5"
            aria-label="Question weight"
            value={question.weight ?? ""}
            placeholder="1"
            onChange={(e) =>
              onChange({
                ...question,
                weight:
                  e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)),
              } as QuestionV1)
            }
            className="h-8 w-14 px-1.5 text-[13px]"
          />
        </label>
      </div>
      <span className="text-muted-foreground text-xs">
        Points can be negative. Show a total with {"{{name}}"} in an ending, or use it in
        a rule.
      </span>
    </div>
  );
}
