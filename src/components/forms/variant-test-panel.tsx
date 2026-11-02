"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import {
  endVariantTestAction,
  saveVariantAction,
  startVariantTestAction,
  updateVariantTestAction,
} from "@/app/(form)/forms/[id]/(sections)/settings/actions";
import type { FormSchemaV1, VariantV1 } from "@/domains/forms/schema/v1";
import type { VariantResults, VariantTest } from "@/domains/forms/variant-tests";
import { MIN_STARTS_PER_ARM } from "@/domains/experiments/stats";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsSection } from "@/components/dashboard/account-settings";
import { toast } from "@/lib/toast";

type Props = {
  formId: string;
  draft: FormSchemaV1;
  publishedVariantIds: string[];
  hasLogic: boolean;
  test: (VariantTest & { results: VariantResults }) | null;
  history: VariantTest[];
  allowed: boolean;
  canManage: boolean;
};

const percent = (rate: number | null) =>
  rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;

function blankVariant(): VariantV1 {
  return { id: `var_${Math.random().toString(36).slice(2, 10)}`, name: "Variant B" };
}

function VariantEditor({
  formId,
  draft,
  hasLogic,
  initial,
  onDone,
}: {
  formId: string;
  draft: FormSchemaV1;
  hasLogic: boolean;
  initial: VariantV1;
  onDone: () => void;
}) {
  const [variant, setVariant] = useState(initial);
  const [pending, start] = useTransition();
  const questions = [...draft.questions].sort((a, b) => a.order - b.order);
  const order = variant.order ?? questions.map((q) => q.id);
  const reword = (
    id: string,
    patch: { label?: string; options?: Record<string, string> },
  ) =>
    setVariant((v) => {
      const current = v.questions?.[id] ?? {};
      const next = { ...current, ...patch };
      if (!next.label) delete next.label;
      if (next.options && Object.keys(next.options).length === 0) delete next.options;
      const all = { ...(v.questions ?? {}) };
      if (Object.keys(next).length) all[id] = next;
      else delete all[id];
      return { ...v, questions: Object.keys(all).length ? all : undefined };
    });
  const move = (index: number, by: -1 | 1) => {
    const next = [...order];
    const [id] = next.splice(index, 1);
    next.splice(index + by, 0, id);
    setVariant((v) => ({ ...v, order: next }));
  };

  return (
    <form
      className="bg-background flex flex-col gap-3.5 rounded-sm p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await saveVariantAction(formId, variant);
          if (result.ok) {
            toast.success("Variant saved to the draft. Publish to test it.");
            onDone();
          } else toast.error(result.message);
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="variant-name">Name</Label>
          <Input
            id="variant-name"
            maxLength={80}
            value={variant.name}
            onChange={(e) => setVariant((v) => ({ ...v, name: e.target.value }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="variant-layout">Layout</Label>
          <select
            id="variant-layout"
            className="border-input bg-field h-9 rounded-sm border-[1.5px] px-2 text-sm"
            value={variant.layout ?? ""}
            onChange={(e) =>
              setVariant((v) => ({
                ...v,
                layout: (e.target.value || undefined) as VariantV1["layout"],
              }))
            }
          >
            <option value="">Same as the original</option>
            <option value="conversational">One question at a time</option>
            <option value="classic">Classic pages</option>
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        <span className="text-sm font-semibold">Wording</span>
        <span className="text-muted-foreground text-xs">
          Leave a field empty to keep the original wording. Answers stay comparable: only
          the words change.
        </span>
        {questions
          .filter((q) => q.type !== "page_break")
          .map((q) => {
            const options =
              (q.settings as { options?: { id: string; label: string }[] }).options ?? [];
            const change = variant.questions?.[q.id];
            return (
              <div
                key={q.id}
                className="border-border flex flex-col gap-1.5 border-t pt-2.5"
              >
                <Input
                  aria-label={`New wording for “${q.label || "Untitled"}”`}
                  placeholder={q.label || "Untitled"}
                  maxLength={1000}
                  value={change?.label ?? ""}
                  onChange={(e) => reword(q.id, { label: e.target.value || undefined })}
                />
                {options.length > 0 && (
                  <div className="grid gap-1.5 pl-4 sm:grid-cols-2">
                    {options.map((o) => (
                      <Input
                        key={o.id}
                        aria-label={`New wording for option “${o.label}”`}
                        placeholder={o.label}
                        maxLength={500}
                        className="h-8 text-[13px]"
                        value={change?.options?.[o.id] ?? ""}
                        onChange={(e) => {
                          const next = { ...(change?.options ?? {}) };
                          if (e.target.value) next[o.id] = e.target.value;
                          else delete next[o.id];
                          reword(q.id, { options: next });
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold">Question order</span>
        {hasLogic ? (
          <span className="text-muted-foreground text-xs">
            This form has logic, so the variant keeps the original order (order changes
            which questions people reach).
          </span>
        ) : (
          <ol className="flex flex-col gap-1">
            {order.map((id, index) => {
              const q = questions.find((x) => x.id === id);
              if (!q) return null;
              const locked = q.type === "welcome_screen";
              return (
                <li key={id} className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground w-5 text-right">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {q.label || (q.type === "page_break" ? "Page break" : "Untitled")}
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Move “${q.label}” up`}
                    disabled={locked || index <= 1}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Move “${q.label}” down`}
                    disabled={locked || index === order.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <ButtonSpinner />}
          Save variant
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** In-form A/B tests (master spec F-29). */
export function VariantTestPanel({
  formId,
  draft,
  publishedVariantIds,
  hasLogic,
  test,
  history,
  allowed,
  canManage,
}: Props) {
  const variant = draft.variants?.[0] ?? null;
  const [editing, setEditing] = useState(false);
  const [split, setSplit] = useState(test?.split ?? 50);
  const [pending, start] = useTransition();
  const run = (work: () => Promise<{ ok: boolean; message?: string }>, done?: string) =>
    start(async () => {
      const result = await work();
      if (result.ok) {
        if (done) toast.success(done);
      } else toast.error(result.message ?? "Something went wrong.");
    });

  const verdict = test?.results.verdict;
  return (
    <SettingsSection
      title="Test a variant"
      description="Try other wording, question order or layout on a share of new visitors, on the same form and link. A winner is only recommended with 95% confidence and at least 100 starts on each side; nothing changes until you adopt it and publish."
      wide
    >
      <div className="flex flex-col gap-4">
        {!allowed && (
          <p className="text-muted-foreground text-sm">
            A/B tests are part of paid plans.
          </p>
        )}
        {allowed && !canManage && (
          <p className="text-muted-foreground text-sm">
            People who can publish this form run its tests.
          </p>
        )}

        {test && (
          <div className="border-border flex flex-col gap-3 rounded-sm border-[1.5px] p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <b className="text-sm">{test.name}</b>
              <span className="bg-secondary rounded-full px-2 py-0.5 text-xs font-semibold">
                {test.status === "running" ? "Running" : "Paused"}
              </span>
              <span className="text-muted-foreground text-xs">
                {test.split}% of new visitors see the variant
              </span>
            </div>
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left text-xs">
                <tr>
                  <th className="py-1 font-semibold">Arm</th>
                  <th className="py-1 font-semibold">Starts</th>
                  <th className="py-1 font-semibold">Completed</th>
                  <th className="py-1 font-semibold">Completion rate</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Original", test.results.arms.original],
                    [variant?.name ?? "Variant", test.results.arms.variant],
                  ] as const
                ).map(([name, arm]) => (
                  <tr key={name} className="border-border border-t">
                    <td className="py-1.5">{name}</td>
                    <td>{arm.started}</td>
                    <td>{arm.completed}</td>
                    <td>{percent(arm.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-sm" role="status">
              {verdict?.kind === "collecting"
                ? `Too early to tell: each side needs at least ${MIN_STARTS_PER_ARM} starts (${verdict.needed} more on the smaller side). Small samples often show differences that aren't real.`
                : verdict?.kind === "no_difference"
                  ? `No clear winner yet (p = ${verdict.pValue.toFixed(3)}). The difference could be chance.`
                  : verdict?.kind === "leading"
                    ? `${verdict.arm === "b" ? (variant?.name ?? "The variant") : "The original"} completes more often, with 95% confidence (p = ${verdict.pValue.toFixed(3)}). Adopt it when you're ready.`
                    : null}
            </p>
            {canManage && (
              <div className="flex flex-wrap items-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () =>
                        updateVariantTestAction(formId, test.id, {
                          status: test.status === "running" ? "paused" : "running",
                        }),
                      test.status === "running" ? "Paused." : "Running again.",
                    )
                  }
                >
                  {test.status === "running" ? "Pause" : "Resume"}
                </Button>
                {test.status === "paused" && (
                  <div className="flex items-end gap-2">
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="variant-split">Split (%)</Label>
                      <Input
                        id="variant-split"
                        type="number"
                        min={1}
                        max={99}
                        className="h-8 w-20"
                        value={split}
                        onChange={(e) => setSplit(Number(e.target.value))}
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () => updateVariantTestAction(formId, test.id, { split }),
                          "Split changed.",
                        )
                      }
                    >
                      Change split
                    </Button>
                  </div>
                )}
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => endVariantTestAction(formId, test.id, test.variantId),
                      "Variant copied into the draft. Review and publish it.",
                    )
                  }
                >
                  Adopt the variant
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => endVariantTestAction(formId, test.id, "original"),
                      "Test ended; the original stays.",
                    )
                  }
                >
                  Keep the original
                </Button>
              </div>
            )}
          </div>
        )}

        {allowed && canManage && !test && (
          <>
            {editing ? (
              <VariantEditor
                formId={formId}
                draft={draft}
                hasLogic={hasLogic}
                initial={variant ?? blankVariant()}
                onDone={() => setEditing(false)}
              />
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  {variant ? `Edit “${variant.name}”` : "Create a variant"}
                </Button>
                {variant && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => saveVariantAction(formId, null),
                        "Variant removed from the draft.",
                      )
                    }
                  >
                    Remove
                  </Button>
                )}
              </div>
            )}
            {variant &&
              !editing &&
              (publishedVariantIds.includes(variant.id) ? (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="variant-start-split">Send to the variant (%)</Label>
                    <Input
                      id="variant-start-split"
                      type="number"
                      min={1}
                      max={99}
                      className="h-9 w-24"
                      value={split}
                      onChange={(e) => setSplit(Number(e.target.value))}
                    />
                  </div>
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () =>
                          startVariantTestAction(formId, {
                            variantId: variant.id,
                            name: `${variant.name} vs original`,
                            split,
                          }),
                        "Test started.",
                      )
                    }
                  >
                    {pending && <ButtonSpinner />}
                    Start test
                  </Button>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Publish the form to make “{variant.name}” live, then start the test
                  here.
                </p>
              ))}
          </>
        )}

        {history.filter((t) => t.status === "ended").length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold">Past tests</span>
            {history
              .filter((t) => t.status === "ended")
              .map((t) => (
                <span key={t.id} className="text-muted-foreground text-xs">
                  {t.name} ·{" "}
                  {t.winner === "original"
                    ? "kept the original"
                    : t.winner
                      ? "adopted the variant"
                      : "ended without a winner"}
                </span>
              ))}
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
