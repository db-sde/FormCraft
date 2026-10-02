"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  Braces,
  CircleAlert,
  CircleCheck,
  Flag,
  List,
  Plus,
  Split,
  Trash2,
  TriangleAlert,
  Workflow,
} from "lucide-react";
import { nanoid } from "nanoid";
import type { ActionV1, RuleV1 } from "@/domains/forms/schema/logic-model";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { analyzeLogic } from "@/domains/forms/schema/analyze";
import { allRules } from "@/domains/forms/references";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "cn";
import { TypeTile } from "./question-meta";
import { ConditionEditor } from "./logic/condition-editor";
import { ActionsEditor } from "./logic/actions-editor";
import { VariablesPanel } from "./logic/variables-panel";
import { DescribeRule, type ProposeRule } from "./logic/describe-rule";
import {
  defaultCompare,
  describeAction,
  describeCondition,
  describeRule,
  numberedQuestions,
} from "./logic/logic-ui";

export { describeRule };

type View = "rules" | "variables" | "map" | "check";

/** The builder's Logic view (Part 4): rules (simple by default, grouped
 * conditions when needed), variables and URL fields, a map generated from
 * the same rules, and the static checks. */
export function LogicEditor({
  schema,
  onChange,
  onSelectQuestion,
  ai,
}: {
  schema: FormSchemaV1;
  onChange: (patch: Partial<FormSchemaV1>) => void;
  onSelectQuestion?: (questionId: string) => void;
  /** "Describe a rule": whether AI is set up, and the server call. */
  ai?: { enabled: boolean; propose: ProposeRule };
}) {
  const [view, setView] = useState<View>("rules");
  const rules = useMemo(() => allRules(schema), [schema]);
  const issues = useMemo(() => analyzeLogic(schema), [schema]);
  const errors = issues.filter((i) => i.severity === "error").length;

  // Editing writes every rule into `rules` (legacy ones keep their ids
  // and order), so there's one list from then on.
  const commit = (next: RuleV1[]) => onChange({ logic: [], rules: next });

  const answerable = numberedQuestions(schema).filter(
    ({ question: q }) => q.type !== "welcome_screen" && q.type !== "statement",
  );

  function addRule() {
    const first = answerable[0]?.question;
    const rule: RuleV1 = first
      ? {
          id: `rule_${nanoid(8)}`,
          on: { event: "question_answered", questionId: first.id },
          when: defaultCompare({ type: "answer", questionId: first.id }, schema),
          then: [{ type: "jump_to_ending", endingId: schema.endings[0].id }],
        }
      : {
          id: `rule_${nanoid(8)}`,
          on: { event: "form_completed" },
          then: [{ type: "jump_to_ending", endingId: schema.endings[0].id }],
        };
    commit([...rules, rule]);
  }

  return (
    <div className="mx-auto flex w-full max-w-[980px] flex-col gap-[18px] px-9 pt-8 pb-16">
      <div className="flex flex-wrap items-end gap-5">
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-[40px] leading-none font-bold tracking-[-0.03em]">
            Logic
          </h1>
          <p className="text-muted-foreground mt-2.5 max-w-[620px] text-[15px] leading-[1.55]">
            Rules run from top to bottom. Every rule that matches updates its variables;
            the first one that matches decides where people go. If none do, the form
            carries on in order.
          </p>
        </div>
        <div
          role="tablist"
          aria-label="Logic"
          className="border-ink bg-card flex gap-0.5 rounded-[8px] border-[1.5px] p-[3px]"
        >
          {(
            [
              ["rules", "Rules", List],
              ["variables", "Variables", Braces],
              ["map", "Map", Workflow],
              ["check", "Check", errors > 0 ? CircleAlert : CircleCheck],
            ] as const
          ).map(([id, text, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              onClick={() => setView(id)}
              className={cn(
                "fc-focus flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-[13.5px] font-semibold",
                view === id
                  ? "bg-secondary text-secondary-foreground"
                  : "hover:bg-hover-wash",
              )}
            >
              <Icon
                className={cn(
                  "size-3.5",
                  id === "check" && errors > 0 && view !== id && "text-destructive",
                )}
              />
              {text}
              {id === "check" && issues.length > 0 && (
                <span className="text-xs tabular-nums opacity-70">{issues.length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {view === "rules" && (
        <>
          <DescribeRule
            schema={schema}
            enabled={ai?.enabled ?? false}
            propose={ai?.propose}
            onAccept={({ rule, newVariables }) =>
              onChange({
                logic: [],
                rules: [...rules, rule],
                variables: [...(schema.variables ?? []), ...newVariables],
              })
            }
          />
          {rules.length === 0 && (
            <div className="border-ink bg-card flex flex-col items-center gap-2 rounded-lg border-[1.5px] border-dashed p-9 text-center">
              <span className="border-ink shadow-card grid size-11 -rotate-6 place-items-center rounded-[10px] border-[1.5px] bg-[var(--qt-other-bg)] text-[var(--qt-other-fg)]">
                <Split className="size-[22px]" />
              </span>
              <b className="font-heading text-[19px]">No logic yet</b>
              <span className="text-muted-foreground max-w-[380px] text-sm">
                Skip questions, send people to different endings, keep a score or work out
                a price, all from what they answer.
              </span>
            </div>
          )}
          {rules.map((rule, index) => (
            <RuleCard
              key={rule.id}
              schema={schema}
              rule={rule}
              index={index}
              onChange={(next) => commit(rules.map((r) => (r.id === rule.id ? next : r)))}
              onDelete={() => commit(rules.filter((r) => r.id !== rule.id))}
            />
          ))}
          <Button className="h-[42px] self-start px-[18px]" onClick={addRule}>
            <Plus /> Add rule
          </Button>
        </>
      )}

      {view === "variables" && <VariablesPanel schema={schema} onChange={onChange} />}

      {view === "map" && <LogicMap schema={schema} rules={rules} />}

      {view === "check" && (
        <div className="flex flex-col gap-2">
          {issues.length === 0 ? (
            <div className="border-ink bg-card flex items-center gap-2.5 rounded-lg border-[1.5px] p-4 text-sm">
              <CircleCheck className="size-5 text-[var(--chip-live-dot)]" />
              Nothing to fix. Every rule points at something that exists, jumps only go
              forward and no condition contradicts itself.
            </div>
          ) : (
            issues.map((issue, i) => (
              <button
                key={i}
                type="button"
                disabled={!issue.questionId || !onSelectQuestion}
                onClick={() => issue.questionId && onSelectQuestion?.(issue.questionId)}
                className={cn(
                  "fc-focus flex items-start gap-2.5 rounded-sm border-[1.5px] px-3 py-2.5 text-left text-[13.5px] leading-[1.45]",
                  issue.severity === "error"
                    ? "border-[var(--alert-error-border)] bg-[var(--alert-error-bg)] text-[var(--alert-error-fg)]"
                    : "border-warning bg-[var(--chip-draft-bg)] text-[var(--chip-draft-fg)]",
                )}
              >
                {issue.severity === "error" ? (
                  <CircleAlert className="mt-px size-4 shrink-0" />
                ) : (
                  <TriangleAlert className="mt-px size-4 shrink-0" />
                )}
                <span>
                  <b>{issue.severity === "error" ? "Fix this: " : "Check this: "}</b>
                  {issue.message}
                </span>
              </button>
            ))
          )}
          <p className="text-muted-foreground text-[12.5px]">
            Problems marked “Fix this” stop the form saving until they&apos;re fixed.
            “Check this” items are allowed but probably not what you meant.
          </p>
        </div>
      )}
    </div>
  );
}

function RuleCard({
  schema,
  rule,
  index,
  onChange,
  onDelete,
}: {
  schema: FormSchemaV1;
  rule: RuleV1;
  index: number;
  onChange: (next: RuleV1) => void;
  onDelete: () => void;
}) {
  const triggerValue =
    rule.on.event === "question_answered" ? `q:${rule.on.questionId}` : rule.on.event;
  const answerable = numberedQuestions(schema).filter(
    ({ question: q }) => q.type !== "welcome_screen",
  );
  const preferredLeft =
    rule.on.event === "question_answered" &&
    schema.questions.some(
      (q) =>
        q.id === (rule.on as { questionId: string }).questionId &&
        q.type !== "statement" &&
        q.type !== "welcome_screen",
    )
      ? ({ type: "answer", questionId: rule.on.questionId } as const)
      : undefined;

  function setTrigger(value: string) {
    const on: RuleV1["on"] = value.startsWith("q:")
      ? { event: "question_answered", questionId: value.slice(2) }
      : { event: value as "form_started" | "form_completed" };
    // A question jump only makes sense after a question.
    const then = rule.then.filter(
      (a: ActionV1) => on.event === "question_answered" || a.type !== "jump_to_question",
    );
    onChange({
      ...rule,
      on,
      then: then.length
        ? then
        : [{ type: "jump_to_ending", endingId: schema.endings[0].id }],
    });
  }

  return (
    <div
      className={cn(
        "border-ink bg-card shadow-card flex gap-3.5 rounded-lg border-[1.5px] p-4",
        rule.disabled && "opacity-60",
      )}
    >
      <span className="bg-secondary font-heading text-primary grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-bold">
        {index + 1}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={triggerValue} onValueChange={setTrigger}>
            <SelectTrigger
              size="sm"
              className="h-[34px] w-auto min-w-[200px] text-[13.5px] font-semibold"
              aria-label={`Rule ${index + 1}: when it runs`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="max-h-80">
              <SelectItem value="form_started">When the form starts</SelectItem>
              {answerable.map(({ question: q, number }) => (
                <SelectItem key={q.id} value={`q:${q.id}`}>
                  After {number} · {q.label.trim() || "Untitled question"}
                </SelectItem>
              ))}
              <SelectItem value="form_completed">When the form is completed</SelectItem>
            </SelectContent>
          </Select>
          <Input
            aria-label={`Rule ${index + 1} name`}
            value={rule.name ?? ""}
            placeholder="Name (optional)"
            onChange={(e) => onChange({ ...rule, name: e.target.value || undefined })}
            className="h-[34px] w-44 px-2.5 text-[13.5px]"
          />
          <span className="flex-1" />
          <label className="text-muted-foreground flex items-center gap-2 text-[13px] font-semibold">
            {rule.disabled ? "Off" : "On"}
            <Switch
              checked={!rule.disabled}
              onCheckedChange={(on) =>
                onChange({ ...rule, disabled: on ? undefined : true })
              }
            />
          </label>
          <button
            type="button"
            aria-label={`Delete rule ${index + 1}`}
            onClick={onDelete}
            className="fc-focus text-destructive grid size-[34px] place-items-center rounded-sm hover:bg-[var(--alert-error-bg)]"
          >
            <Trash2 className="size-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-start gap-2">
          <b className="w-[52px] shrink-0 pt-1.5 text-sm">If</b>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="border-input bg-background flex gap-0.5 self-start rounded-[7px] border-[1.5px] p-[2px]">
              {(["always", "when"] as const).map((mode) => {
                const active = mode === "always" ? !rule.when : !!rule.when;
                return (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      if (mode === "always") {
                        onChange({ ...rule, when: undefined });
                        return;
                      }
                      if (rule.when) return;
                      const left = preferredLeft ?? firstOperand(schema);
                      if (left) onChange({ ...rule, when: defaultCompare(left, schema) });
                    }}
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
            {rule.when && (
              <ConditionEditor
                schema={schema}
                value={rule.when}
                onChange={(when) => onChange({ ...rule, when })}
                preferredLeft={preferredLeft}
                label={`Rule ${index + 1}`}
              />
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-2">
          <b className="w-[52px] shrink-0 pt-1.5 text-sm">Then</b>
          <div className="min-w-0 flex-1">
            <ActionsEditor
              schema={schema}
              rule={rule}
              onChange={(then) => onChange({ ...rule, then })}
            />
          </div>
        </div>

        <p className="text-muted-foreground border-border border-t pt-2 text-[12.5px] leading-normal">
          {describeRule(rule, schema)}.
        </p>
      </div>
    </div>
  );
}

/** The first thing a new condition can check. */
function firstOperand(schema: FormSchemaV1) {
  const q = numberedQuestions(schema).find(
    ({ question }) => question.type !== "welcome_screen" && question.type !== "statement",
  );
  if (q) return { type: "answer" as const, questionId: q.question.id };
  const v = (schema.variables ?? [])[0];
  return v ? { type: "variable" as const, variableId: v.id } : null;
}

/** Read-only flow generated from the canonical rules — never a second
 * representation that could drift. */
function LogicMap({ schema, rules }: { schema: FormSchemaV1; rules: RuleV1[] }) {
  const steps = numberedQuestions(schema).filter(
    ({ question: q }) => q.type !== "welcome_screen",
  );
  const active = rules.filter((r) => !r.disabled);
  const incoming = (id: string) => {
    const from = active
      .filter((r) =>
        r.then.some(
          (a) =>
            (a.type === "jump_to_question" && a.questionId === id) ||
            (a.type === "jump_to_ending" && a.endingId === id) ||
            (a.type === "go_to_highest" && a.candidates.some((c) => c.endingId === id)),
        ),
      )
      .map((r) =>
        r.on.event === "question_answered"
          ? String(
              steps.find(
                (s) => s.question.id === (r.on as { questionId: string }).questionId,
              )?.number ?? "?",
            )
          : r.on.event === "form_completed"
            ? "end"
            : "start",
      );
    return from.length ? `← ${[...new Set(from)].join(", ")}` : null;
  };
  const completion = active.filter((r) => r.on.event === "form_completed");
  const start = active.filter((r) => r.on.event === "form_started");

  const branch = (rule: RuleV1) => (
    <div key={rule.id} className="flex min-w-0 items-center gap-2 text-[13px]">
      <span className="border-warning w-7 shrink-0 border-t-[1.5px] border-dashed" />
      <span className="border-warning bg-accent min-w-0 truncate rounded-full border-[1.5px] px-[9px] py-[3px] font-semibold">
        {rule.when ? describeCondition(rule.when, schema) : "always"}
      </span>
      <ArrowRight className="size-3 shrink-0 text-[#9a6a0c]" />
      <span className="min-w-0 truncate font-semibold">
        {rule.then.map((a) => describeAction(a, schema)).join(", ")}
      </span>
    </div>
  );

  return (
    <>
      <div className="border-ink bg-card flex flex-col rounded-lg border-[1.5px] p-[22px]">
        {start.length > 0 && (
          <div className="mb-3 flex flex-col gap-1.5">{start.map(branch)}</div>
        )}
        {steps.map(({ question: q, number }, i) => {
          const branches = active.filter(
            (r) => r.on.event === "question_answered" && r.on.questionId === q.id,
          );
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
                    q.visibleIf && "border-dashed",
                  )}
                >
                  <span className="w-[18px] text-right text-xs font-bold">{number}</span>
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
                {q.visibleIf && (
                  <span className="text-muted-foreground mt-1 ml-7 text-[12px]">
                    shown if {describeCondition(q.visibleIf, schema)}
                  </span>
                )}
                {i < steps.length - 1 && (
                  <span className="border-subtle-foreground ml-6 h-3.5 border-l-[1.5px]" />
                )}
              </div>
              <div className="flex flex-col gap-1.5 pt-1">{branches.map(branch)}</div>
            </div>
          );
        })}
        {completion.length > 0 && (
          <div className="border-input mt-3 flex flex-col gap-1.5 border-t-[1.5px] border-dashed pt-3">
            <span className="text-muted-foreground text-[11.5px] font-bold tracking-[0.1em] uppercase">
              When the form is completed
            </span>
            {completion.map(branch)}
          </div>
        )}
        <div className="border-input mt-1.5 flex flex-wrap gap-2.5 border-t-[1.5px] border-dashed pt-3.5">
          {schema.endings.map((e) => {
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
        Generated from your rules. Solid lines are the default order, dashed lines are
        rules, and a dashed box is a question that&apos;s only shown sometimes.
      </span>
    </>
  );
}
