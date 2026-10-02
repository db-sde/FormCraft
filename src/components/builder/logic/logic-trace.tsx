"use client";

import { ArrowRight, Check, Flag, MinusCircle, TriangleAlert, X } from "lucide-react";
import type { CompiledFormV1 } from "@/domains/forms/schema/compile";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { formatValue } from "@/domains/logic/recall";
import { walkForm, type TraceEntry } from "@/domains/logic";
import { allRules } from "@/domains/forms/references";
import { describeRule, endingName, questionName } from "./logic-ui";

/** One trace entry in plain words, or null for noise. */
function describeEntry(
  entry: TraceEntry,
  schema: FormSchemaV1,
): { icon: React.ReactNode; text: string } | null {
  const rules = allRules(schema);
  const ruleText = (id: string) => {
    const index = rules.findIndex((r) => r.id === id);
    const rule = rules[index];
    return rule ? `Rule ${index + 1}${rule.name ? ` “${rule.name}”` : ""}` : "A rule";
  };
  const variableName = (id: string) =>
    (schema.variables ?? []).find((v) => v.id === id)?.name ?? "a variable";
  switch (entry.kind) {
    case "question_shown":
      return {
        icon: <ArrowRight className="size-3.5" />,
        text: `Showed ${questionName(schema, entry.questionId)}`,
      };
    case "question_skipped":
      return {
        icon: <MinusCircle className="size-3.5" />,
        text: `Skipped ${questionName(schema, entry.questionId)}: ${
          entry.reason === "pool"
            ? "not picked from its random group this time"
            : "its show condition isn't met"
        }`,
      };
    case "rule_matched": {
      const rule = rules.find((r) => r.id === entry.ruleId);
      return {
        icon: <Check className="size-3.5 text-[var(--chip-live-dot)]" />,
        text: `${ruleText(entry.ruleId)} matched${rule ? ` — ${describeRule(rule, schema)}` : ""}`,
      };
    }
    case "rule_not_matched":
      return null;
    case "variable_changed": {
      const why = entry.optionId
        ? ` (option in ${questionName(schema, entry.questionId ?? "")})`
        : entry.ruleId
          ? ` (${ruleText(entry.ruleId)})`
          : "";
      return {
        icon: <span className="font-mono text-[11px] font-bold">=</span>,
        text: `${variableName(entry.variableId)}: ${formatValue(entry.from) || "—"} → ${formatValue(entry.to) || "—"}${why}`,
      };
    }
    case "jump":
      return {
        icon: <ArrowRight className="size-3.5 text-[#9a6a0c]" />,
        text: `${ruleText(entry.ruleId)} jumped to ${entry.to.type === "question" ? questionName(schema, entry.to.questionId) : endingName(schema, entry.to.endingId)}`,
      };
    case "ending":
      return {
        icon: <Flag className="size-3.5" />,
        text: `Ending “${endingName(schema, entry.endingId)}” — ${
          entry.reason === "default"
            ? "the default (no rule chose another)"
            : entry.reason === "highest"
              ? `highest score (${ruleText(entry.ruleId ?? "")})`
              : `chosen by ${ruleText(entry.ruleId ?? "")}`
        }`,
      };
    case "warning":
      return {
        icon: <TriangleAlert className="size-3.5 text-[var(--chip-changes-dot)]" />,
        text: entry.message,
      };
  }
}

/**
 * The simulator's read-out (Phase 26–27): with the answers given so far,
 * the path the form would take, the ending it would reach, every
 * variable, and why — straight from the engine the live form uses.
 */
export function LogicTrace({
  compiled,
  answers,
  hidden,
  seed,
}: {
  compiled: CompiledFormV1;
  answers: Record<string, unknown>;
  hidden: Record<string, string>;
  seed?: string;
}) {
  const schema = compiled.schema;
  const walk = walkForm(compiled, answers, { hidden, seed });
  const variables = schema.variables ?? [];
  const entries = walk.trace
    .map((e) => describeEntry(e, schema))
    .filter((e): e is { icon: React.ReactNode; text: string } => e !== null);

  return (
    <div className="flex flex-col gap-4 text-[13px]">
      <section>
        <h3 className="text-muted-foreground mb-1.5 text-[11px] font-bold tracking-[0.1em] uppercase">
          Path if submitted now
        </h3>
        <p className="leading-relaxed">
          {walk.visitedQuestionIds.map((id) => questionName(schema, id, 18)).join(" → ")}
          {" → "}
          <b>“{endingName(schema, walk.endingId)}”</b>
        </p>
        {walk.validationErrors.length > 0 && (
          <p className="text-destructive mt-1 flex items-start gap-1.5">
            <X className="mt-0.5 size-3.5 shrink-0" />
            {walk.validationErrors.length} check
            {walk.validationErrors.length === 1 ? "" : "s"} would fail:{" "}
            {walk.validationErrors.map((e) => e.message).join(" · ")}
          </p>
        )}
      </section>

      {variables.length > 0 && (
        <section>
          <h3 className="text-muted-foreground mb-1.5 text-[11px] font-bold tracking-[0.1em] uppercase">
            Variables
          </h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            {variables.map((v) => (
              <div key={v.id} className="contents">
                <dt className="font-mono">{v.name}</dt>
                <dd className="font-semibold">
                  {formatValue(walk.variables[v.id]) || "—"}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section>
        <h3 className="text-muted-foreground mb-1.5 text-[11px] font-bold tracking-[0.1em] uppercase">
          Why
        </h3>
        <ol className="flex flex-col gap-1">
          {entries.map((e, i) => (
            <li key={i} className="flex items-start gap-2 leading-snug">
              <span className="mt-0.5 grid w-4 shrink-0 place-items-center">
                {e.icon}
              </span>
              <span className="min-w-0">{e.text}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
