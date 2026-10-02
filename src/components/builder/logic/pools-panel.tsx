"use client";

import { Plus, Shuffle, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import type { QuestionPoolV1 } from "@/domains/forms/schema/logic-model";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "cn";
import { numberedQuestions } from "./logic-ui";

/**
 * Random groups (question pools, logic spec phase 19): each respondent
 * is asked a few questions picked at random from a group — fixed for
 * their response, so the server asks the same ones. Skipped questions
 * are never required.
 */
export function PoolsPanel({
  schema,
  onChange,
}: {
  schema: FormSchemaV1;
  onChange: (patch: Partial<FormSchemaV1>) => void;
}) {
  const pools = schema.pools ?? [];
  const questions = numberedQuestions(schema).filter(
    ({ question }) => question.type !== "welcome_screen",
  );
  const taken = new Map(pools.flatMap((p) => p.questionIds.map((id) => [id, p.id])));
  const commit = (next: QuestionPoolV1[]) =>
    onChange({ pools: next.length ? next : undefined });
  const update = (id: string, patch: Partial<QuestionPoolV1>) =>
    commit(pools.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground max-w-[620px] text-[14px] leading-[1.55]">
        Ask each person a few questions picked at random from a group: good for quizzes
        with a question bank, or long surveys you want to keep short. Questions that
        aren&apos;t picked are skipped and never required.
      </p>
      {pools.map((pool, index) => {
        const label = pool.name?.trim() || `Random group ${index + 1}`;
        return (
          <section
            key={pool.id}
            aria-label={label}
            className="border-ink bg-card flex flex-col gap-3 rounded-lg border-[1.5px] p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Shuffle className="size-4" aria-hidden />
              <Input
                aria-label="Group name"
                value={pool.name ?? ""}
                placeholder={`Random group ${index + 1}`}
                maxLength={80}
                onChange={(e) => update(pool.id, { name: e.target.value || undefined })}
                className="h-[34px] max-w-[260px] text-sm font-semibold"
              />
              <span className="flex-1" />
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${label}`}
                onClick={() => commit(pools.filter((p) => p.id !== pool.id))}
              >
                <Trash2 />
              </Button>
            </div>
            <div className="flex items-center gap-2 text-sm">
              Ask
              <Input
                type="number"
                aria-label={`How many questions to ask from ${label}`}
                min={1}
                max={Math.max(1, pool.questionIds.length - 1)}
                value={pool.pick}
                onChange={(e) => {
                  const pick = Math.floor(Number(e.target.value));
                  if (pick >= 1) update(pool.id, { pick });
                }}
                className="h-[34px] w-[72px] text-sm"
              />
              of these {pool.questionIds.length} questions:
            </div>
            <ul className="flex flex-wrap gap-1.5">
              {questions.map(({ question, number }) => {
                const inThis = pool.questionIds.includes(question.id);
                const elsewhere = !inThis && taken.has(question.id);
                return (
                  <li key={question.id}>
                    <button
                      type="button"
                      aria-pressed={inThis}
                      disabled={elsewhere}
                      title={elsewhere ? "Already in another random group" : undefined}
                      onClick={() =>
                        update(pool.id, {
                          questionIds: inThis
                            ? pool.questionIds.filter((id) => id !== question.id)
                            : [...pool.questionIds, question.id],
                        })
                      }
                      className={cn(
                        "fc-focus rounded-full border-[1.5px] px-2.5 py-1 text-[12.5px] font-semibold",
                        inThis
                          ? "border-ink bg-primary text-primary-foreground"
                          : "border-input hover:bg-hover-wash",
                        elsewhere && "opacity-40",
                      )}
                    >
                      {number} · {question.label.trim().slice(0, 28) || "Untitled"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <Button
        className="h-[42px] self-start px-[18px]"
        disabled={questions.length < 2}
        onClick={() => {
          const free = questions.filter(({ question }) => !taken.has(question.id));
          commit([
            ...pools,
            {
              id: `pool_${nanoid(8)}`,
              questionIds: free.slice(0, 2).map(({ question }) => question.id),
              pick: 1,
            },
          ]);
        }}
      >
        <Plus /> Add a random group
      </Button>
    </div>
  );
}
