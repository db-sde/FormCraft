"use client";

import { useState } from "react";
import { ArrowRight, Flag, List, Plus, Split, Trash2, Workflow } from "lucide-react";
import type {
  QuestionV1,
  EndingV1,
  LogicRuleV1,
  LogicActionV1,
} from "@/domains/forms/schema/v1";
import type { LogicOperator } from "@/domains/forms/schema/question-types";
import {
  createLogicRule,
  availableOperators,
  questionsAfter,
} from "@/domains/forms/builder";
import { LogicValueControl } from "./logic-value-control";
import { TypeTile } from "./question-meta";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "cn";

const OPERATOR_LABEL: Record<LogicOperator, string> = {
  equals: "is",
  not_equals: "is not",
  contains: "contains",
  gt: "is greater than",
  lt: "is less than",
  is_answered: "is answered",
  is_not_answered: "is not answered",
};

const isAnswerable = (q: QuestionV1) =>
  q.type !== "welcome_screen" && q.type !== "statement";

/** Respondent-facing step numbers (the welcome screen has none). */
function numbering(questions: QuestionV1[]): Map<string, number> {
  const map = new Map<string, number>();
  let n = 0;
  for (const q of questions) if (q.type !== "welcome_screen") map.set(q.id, ++n);
  return map;
}

function short(label: string, max: number) {
  const text = label || "Untitled question";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function valueText(question: QuestionV1 | undefined, value: unknown): string {
  if (value === undefined || value === null || value === "") return "…";
  if (question && "options" in question.settings) {
    const options = (question.settings as { options: { id: string; label: string }[] })
      .options;
    const match = options.find((o) => o.id === value);
    if (match) return `“${match.label}”`;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return `“${String(value)}”`;
}

/** A rule in words: the question it checks, the test ("is “Solo”")
 * and where it sends people. Used by the map and the delete dialog. */
export function describeRule(
  rule: LogicRuleV1,
  questions: QuestionV1[],
  endings: EndingV1[],
): { question: string; test: string; target: string } {
  const numbers = numbering(questions);
  const source = questions.find((q) => q.id === rule.questionId);
  const needsValue =
    rule.operator !== "is_answered" && rule.operator !== "is_not_answered";
  const question = source
    ? `${numbers.get(source.id) ?? ""} · ${short(source.label, 28)}`
    : "A deleted question";
  const test = needsValue
    ? `${OPERATOR_LABEL[rule.operator]} ${valueText(source, rule.value)}`
    : OPERATOR_LABEL[rule.operator];
  let target: string;
  if (rule.action.type === "jump_to_question") {
    const id = rule.action.questionId;
    const q = questions.find((x) => x.id === id);
    target = q
      ? `${numbers.get(q.id) ?? ""} · ${short(q.label, 32)}`
      : "A deleted question";
  } else {
    const id = rule.action.endingId;
    const e = endings.find((x) => x.id === id);
    target = `Ending: ${e?.title || "Untitled ending"}`;
  }
  return { question, test, target };
}

/** The builder's Logic view (Part 4): editable rule cards, or a
 * read-only map of where each question can lead. */
export function LogicEditor({
  questions,
  endings,
  logic,
  onChange,
}: {
  questions: QuestionV1[];
  endings: EndingV1[];
  logic: LogicRuleV1[];
  onChange: (logic: LogicRuleV1[]) => void;
}) {
  const [view, setView] = useState<"rules" | "map">("rules");
  const answerable = questions.filter(isAnswerable);
  const numbers = numbering(questions);

  function updateRule(id: string, patch: Partial<LogicRuleV1>) {
    onChange(logic.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function addRule() {
    const firstQuestion = answerable[0];
    const firstEnding = endings.find((e) => e.isDefault) ?? endings[0];
    if (!firstQuestion || !firstEnding) return;
    onChange([
      ...logic,
      createLogicRule(firstQuestion.id, {
        type: "jump_to_ending",
        endingId: firstEnding.id,
      }),
    ]);
  }

  const laterIds = (rule: LogicRuleV1) =>
    new Set(questionsAfter(questions, rule.questionId).map((q) => q.id));

  // Only questions further on — jumping back could loop forever. A rule
  // saved before that restriction keeps its old target visible (marked)
  // so the creator can see what to replace.
  function jumpTargets(rule: LogicRuleV1): QuestionV1[] {
    const later = questionsAfter(questions, rule.questionId);
    if (rule.action.type !== "jump_to_question") return later;
    const current = rule.action.questionId;
    const stale = later.some((q) => q.id === current)
      ? undefined
      : questions.find((q) => q.id === current);
    return stale ? [stale, ...later] : later;
  }

  function removeRule(id: string) {
    onChange(logic.filter((r) => r.id !== id));
  }

  const label = (q: QuestionV1, max = 34) =>
    `${numbers.get(q.id) ?? ""} · ${short(q.label, max)}`;

  return (
    <div className="mx-auto flex w-full max-w-[980px] flex-col gap-[18px] px-9 pt-8 pb-16">
      <div className="flex flex-wrap items-end gap-5">
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-[40px] leading-none font-bold tracking-[-0.03em]">
            Logic
          </h1>
          <p className="text-muted-foreground mt-2.5 max-w-[620px] text-[15px] leading-[1.55]">
            Rules run from top to bottom and the first one that matches wins. If nothing
            matches, the form carries on in order.
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label="View"
          className="border-ink bg-card flex gap-0.5 rounded-[8px] border-[1.5px] p-[3px]"
        >
          {(
            [
              ["rules", "Rules", List],
              ["map", "Map", Workflow],
            ] as const
          ).map(([id, text, Icon]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={view === id}
              onClick={() => setView(id)}
              className={cn(
                "fc-focus flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-[13.5px] font-semibold",
                view === id
                  ? "bg-secondary text-secondary-foreground"
                  : "hover:bg-hover-wash",
              )}
            >
              <Icon className="size-3.5" />
              {text}
            </button>
          ))}
        </div>
      </div>

      {view === "rules" ? (
        <>
          {logic.length === 0 && (
            <div className="border-ink bg-card flex flex-col items-center gap-2 rounded-lg border-[1.5px] border-dashed p-9 text-center">
              <span className="border-ink shadow-card grid size-11 -rotate-6 place-items-center rounded-[10px] border-[1.5px] bg-[var(--qt-other-bg)]">
                <Split className="size-[22px]" />
              </span>
              <b className="font-heading text-[19px]">No logic yet</b>
              <span className="text-muted-foreground max-w-[360px] text-sm">
                Add a rule to skip questions or send people to a different ending based on
                their answers.
              </span>
            </div>
          )}

          {logic.map((rule, index) => {
            const sourceQuestion = questions.find((q) => q.id === rule.questionId);
            const operators = sourceQuestion
              ? availableOperators(sourceQuestion.type)
              : [];

            return (
              <div
                key={rule.id}
                className="border-ink bg-card shadow-card flex gap-3.5 rounded-lg border-[1.5px] p-4"
              >
                <span className="bg-secondary font-heading text-primary grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-bold">
                  {index + 1}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="w-[60px] shrink-0 text-sm whitespace-nowrap">If</b>
                    <Select
                      value={rule.questionId}
                      onValueChange={(questionId) => {
                        const q = questions.find((x) => x.id === questionId);
                        const ops = q ? availableOperators(q.type) : [];
                        updateRule(rule.id, {
                          questionId,
                          operator: ops.includes(rule.operator) ? rule.operator : ops[0],
                          value: undefined,
                        });
                      }}
                    >
                      <SelectTrigger
                        className="h-9 w-56"
                        aria-label={`Rule ${index + 1} question`}
                      >
                        <SelectValue placeholder="Choose question" />
                      </SelectTrigger>
                      <SelectContent>
                        {answerable.map((q) => (
                          <SelectItem key={q.id} value={q.id}>
                            {label(q)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select
                      value={rule.operator}
                      onValueChange={(operator) =>
                        updateRule(rule.id, {
                          operator: operator as LogicOperator,
                          value: undefined,
                        })
                      }
                    >
                      <SelectTrigger
                        className="h-9 w-40"
                        aria-label={`Rule ${index + 1} condition`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {operators.map((op) => (
                          <SelectItem key={op} value={op}>
                            {OPERATOR_LABEL[op]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <LogicValueControl
                      question={sourceQuestion}
                      operator={rule.operator}
                      value={rule.value}
                      onChange={(value) => updateRule(rule.id, { value })}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <b className="w-[60px] shrink-0 text-sm whitespace-nowrap">Then →</b>
                    <Select
                      value={rule.action.type}
                      onValueChange={(actionType) => {
                        const action: LogicActionV1 =
                          actionType === "jump_to_question"
                            ? {
                                type: "jump_to_question",
                                questionId:
                                  questionsAfter(questions, rule.questionId)[0]?.id ?? "",
                              }
                            : {
                                type: "jump_to_ending",
                                endingId:
                                  endings.find((e) => e.isDefault)?.id ??
                                  endings[0]?.id ??
                                  "",
                              };
                        updateRule(rule.id, { action });
                      }}
                    >
                      <SelectTrigger
                        className="h-9 w-44"
                        aria-label={`Rule ${index + 1} action`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem
                          value="jump_to_question"
                          disabled={
                            questionsAfter(questions, rule.questionId).length === 0
                          }
                        >
                          Jump to question
                        </SelectItem>
                        <SelectItem value="jump_to_ending">Go to ending</SelectItem>
                      </SelectContent>
                    </Select>

                    {rule.action.type === "jump_to_question" ? (
                      <Select
                        value={rule.action.questionId}
                        onValueChange={(questionId) =>
                          updateRule(rule.id, {
                            action: { type: "jump_to_question", questionId },
                          })
                        }
                      >
                        <SelectTrigger
                          className="h-9 w-60"
                          aria-label={`Rule ${index + 1} target`}
                        >
                          <SelectValue placeholder="Choose question" />
                        </SelectTrigger>
                        <SelectContent>
                          {jumpTargets(rule).map((q) => (
                            <SelectItem key={q.id} value={q.id}>
                              {label(q)}
                              {laterIds(rule).has(q.id)
                                ? ""
                                : " (earlier — pick a later one)"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Select
                        value={rule.action.endingId}
                        onValueChange={(endingId) =>
                          updateRule(rule.id, {
                            action: { type: "jump_to_ending", endingId },
                          })
                        }
                      >
                        <SelectTrigger
                          className="h-9 w-60"
                          aria-label={`Rule ${index + 1} target`}
                        >
                          <SelectValue placeholder="Choose ending" />
                        </SelectTrigger>
                        <SelectContent>
                          {endings.map((e) => (
                            <SelectItem key={e.id} value={e.id}>
                              {e.title || "Untitled ending"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`Delete rule ${index + 1}`}
                  onClick={() => removeRule(rule.id)}
                  className="fc-focus text-destructive grid size-[34px] shrink-0 place-items-center rounded-sm hover:bg-[var(--alert-error-bg)]"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            );
          })}

          <Button
            className="h-[42px] self-start px-[18px]"
            onClick={addRule}
            disabled={answerable.length === 0}
          >
            <Plus /> Add rule
          </Button>
        </>
      ) : (
        <LogicMap questions={questions} endings={endings} logic={logic} />
      )}
    </div>
  );
}

function LogicMap({
  questions,
  endings,
  logic,
}: {
  questions: QuestionV1[];
  endings: EndingV1[];
  logic: LogicRuleV1[];
}) {
  const steps = questions.filter((q) => q.type !== "welcome_screen");
  const numbers = numbering(questions);
  const incoming = (id: string) => {
    const from = logic
      .filter((r) =>
        r.action.type === "jump_to_question"
          ? r.action.questionId === id
          : r.action.endingId === id,
      )
      .map((r) => numbers.get(r.questionId))
      .filter((n): n is number => n !== undefined);
    return from.length ? `← ${from.join(", ")}` : null;
  };

  return (
    <>
      <div className="border-ink bg-card flex flex-col rounded-lg border-[1.5px] p-[22px]">
        {steps.map((q, i) => {
          const branches = logic.filter((r) => r.questionId === q.id);
          const into = incoming(q.id);
          return (
            <div
              key={q.id}
              className="grid grid-cols-[minmax(0,340px)_minmax(0,1fr)] items-start gap-4"
            >
              <div className="flex flex-col items-start">
                <div
                  className={cn(
                    "border-ink flex w-full items-center gap-2 rounded-[8px] border-[1.5px] px-2.5 py-2",
                    branches.length ? "bg-accent shadow-raised" : "bg-card",
                  )}
                >
                  <span className="w-[18px] text-right text-xs font-bold">
                    {numbers.get(q.id)}
                  </span>
                  <TypeTile type={q.type} size={22} />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">
                    {q.label || "Untitled question"}
                  </span>
                  {into && (
                    <span className="bg-secondary text-primary rounded-full px-[7px] py-px text-[10.5px] font-bold whitespace-nowrap">
                      {into}
                    </span>
                  )}
                </div>
                {i < steps.length - 1 && (
                  <span className="border-subtle-foreground ml-6 h-3.5 border-l-[1.5px]" />
                )}
              </div>
              <div className="flex flex-col gap-1.5 pt-1">
                {branches.map((rule) => {
                  const { test, target } = describeRule(rule, questions, endings);
                  return (
                    <div
                      key={rule.id}
                      className="flex min-w-0 items-center gap-2 text-[13px]"
                    >
                      <span className="border-warning w-7 shrink-0 border-t-[1.5px] border-dashed" />
                      <span className="border-warning bg-accent truncate rounded-full border-[1.5px] px-[9px] py-[3px] font-semibold">
                        {test}
                      </span>
                      <ArrowRight className="size-3 shrink-0 text-[#9a6a0c]" />
                      <span className="truncate font-semibold">{target}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div className="border-input mt-1.5 flex flex-wrap gap-2.5 border-t-[1.5px] border-dashed pt-3.5">
          {endings.map((e) => {
            const into = incoming(e.id);
            return (
              <span
                key={e.id}
                className="border-ink flex items-center gap-2 rounded-[8px] border-[1.5px] bg-[var(--qt-screens-bg)] px-3 py-2 text-[13.5px] font-semibold"
              >
                <Flag className="size-[13px] text-[var(--qt-screens-fg)]" />
                {e.title || "Untitled ending"}
                {e.isDefault && " (default)"}
                {into && (
                  <span className="bg-secondary text-primary rounded-full px-[7px] py-px text-[10.5px] font-bold">
                    {into}
                  </span>
                )}
              </span>
            );
          })}
        </div>
      </div>
      <span className="text-muted-foreground text-[12.5px]">
        The map is read-only. Switch to Rules to edit. Solid lines are the default order
        and dashed lines are rules.
      </span>
    </>
  );
}
