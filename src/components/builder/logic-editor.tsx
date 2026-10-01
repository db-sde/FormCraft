"use client";

import { Plus, Trash2, ArrowRight } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const OPERATOR_LABEL: Record<LogicOperator, string> = {
  equals: "is",
  not_equals: "is not",
  contains: "contains",
  gt: "is greater than",
  lt: "is less than",
  is_answered: "is answered",
  is_not_answered: "is not answered",
};

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
  const answerable = questions.filter(
    (q) => q.type !== "welcome_screen" && q.type !== "statement",
  );

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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold">Logic</h2>
        <p className="text-muted-foreground text-sm">
          Rules run top to bottom — the first one that matches decides where the
          respondent goes next. If none match, the form continues in order.
        </p>
      </div>

      {logic.length === 0 && (
        <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
          No logic yet. Add a rule to branch the form based on an answer.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {logic.map((rule, index) => {
          const sourceQuestion = questions.find((q) => q.id === rule.questionId);
          const operators = sourceQuestion ? availableOperators(sourceQuestion.type) : [];

          return (
            <div key={rule.id} className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground w-6 shrink-0 font-mono text-xs">
                  {index + 1}.
                </span>
                <span className="text-muted-foreground font-medium">If</span>

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
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Choose question" />
                  </SelectTrigger>
                  <SelectContent>
                    {answerable.map((q) => (
                      <SelectItem key={q.id} value={q.id}>
                        {q.label || "Untitled question"}
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
                  <SelectTrigger className="w-40">
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

                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive hover:text-destructive ml-auto"
                  aria-label={`Delete rule ${index + 1}`}
                  onClick={() => removeRule(rule.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-2 pl-8 text-sm">
                <span className="text-muted-foreground font-medium">Then</span>
                <ArrowRight className="text-muted-foreground size-3.5" />

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
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      value="jump_to_question"
                      disabled={questionsAfter(questions, rule.questionId).length === 0}
                    >
                      Jump to question
                    </SelectItem>
                    <SelectItem value="jump_to_ending">Jump to ending</SelectItem>
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
                    <SelectTrigger className="w-56">
                      <SelectValue placeholder="Choose question" />
                    </SelectTrigger>
                    <SelectContent>
                      {jumpTargets(rule).map((q) => (
                        <SelectItem key={q.id} value={q.id}>
                          {q.label || "Untitled question"}
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
                    <SelectTrigger className="w-56">
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
          );
        })}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addRule}
        disabled={answerable.length === 0}
      >
        <Plus /> Add rule
      </Button>
    </div>
  );
}
