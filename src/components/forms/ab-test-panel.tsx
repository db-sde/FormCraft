"use client";

import { useState, useTransition } from "react";
import { FlaskConical } from "lucide-react";
import {
  startExperimentAction,
  stopExperimentAction,
} from "@/app/(form)/forms/[id]/(sections)/settings/actions";
import type { Arm, ExperimentResults } from "@/domains/experiments";
import { SettingsSection } from "@/components/dashboard/account-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/toast";

const percent = (rate: number | null) =>
  rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;

function verdictText(test: ExperimentResults): string {
  const v = test.verdict;
  if (v.kind === "collecting" && test.status === "stopped")
    return "Ended before there was enough data to compare.";
  if (v.kind === "collecting")
    return `Collecting data: each version needs ${v.needed} more start${v.needed === 1 ? "" : "s"} before results mean anything.`;
  if (v.kind === "no_difference")
    return "No clear difference yet. The gap so far could easily be chance.";
  return `Version ${v.arm.toUpperCase()} completes more often (95% confidence).`;
}

function ArmRow({
  label,
  title,
  stats,
  share,
}: {
  label: string;
  title: string;
  stats: ExperimentResults["arms"]["a"];
  share: number;
}) {
  return (
    <tr className="border-border border-b last:border-b-0">
      <td className="py-2 pr-3 font-bold">{label}</td>
      <td className="max-w-[16rem] truncate py-2 pr-3">{title}</td>
      <td className="py-2 pr-3 tabular-nums">{share}%</td>
      <td className="py-2 pr-3 tabular-nums">{stats.started}</td>
      <td className="py-2 pr-3 tabular-nums">{stats.completed}</td>
      <td className="py-2 tabular-nums">{percent(stats.rate)}</td>
    </tr>
  );
}

/** A/B tests (P3.9): split this form's link with another published form,
 * compare completion rates, and pick a winner. */
export function AbTestPanel({
  formId,
  formTitle,
  tests,
  candidates,
  allowed,
  canManage,
}: {
  formId: string;
  formTitle: string;
  tests: ExperimentResults[];
  candidates: { id: string; title: string }[];
  allowed: boolean;
  canManage: boolean;
}) {
  const [pending, start] = useTransition();
  const [variant, setVariant] = useState(candidates[0]?.id ?? "");
  const [name, setName] = useState("");
  const [split, setSplit] = useState(50);
  const running = tests.find((t) => t.status === "running");

  const stop = (test: ExperimentResults, winner: Arm | null) => {
    const message =
      winner === "b"
        ? "End the test and copy version B into this form's draft? Review and publish the draft to make it live."
        : winner === "a"
          ? "End the test and keep this form as it is?"
          : "End the test without picking a winner?";
    if (test.verdict.kind !== "leading" && winner) {
      if (
        !window.confirm(`There's no clear winner yet, so this may be chance. ${message}`)
      )
        return;
    } else if (!window.confirm(message)) return;
    start(async () => {
      const result = await stopExperimentAction(formId, test.id, winner);
      if (!result.ok) toast.error(result.message);
      else if (result.copiedIntoDraft)
        toast.success(
          "Test ended. Version B is now this form's draft — publish it when ready.",
        );
      else toast.success("Test ended. Everyone gets this form again.");
    });
  };

  return (
    <SettingsSection
      title="A/B test"
      description="Send part of this form's traffic to another published form and compare how often people finish. Each visitor always sees the same version."
      wide
    >
      {!allowed ? (
        <p className="text-muted-foreground text-sm">
          A/B tests are included in the Business plan.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {running ? null : canManage ? (
            candidates.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Publish another form in this workspace to test it against this one.
              </p>
            ) : (
              <form
                className="border-ink bg-card flex flex-col gap-3 rounded-lg border-[1.5px] p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  start(async () => {
                    const result = await startExperimentAction(formId, {
                      variantFormId: variant,
                      name: name.trim() || "A/B test",
                      split,
                    });
                    if (result.ok) {
                      toast.success("Test started.");
                      setName("");
                    } else toast.error(result.message);
                  });
                }}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ab-name">Test name</Label>
                    <Input
                      id="ab-name"
                      value={name}
                      maxLength={80}
                      placeholder="Shorter intro"
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ab-variant">Version B</Label>
                    <select
                      id="ab-variant"
                      value={variant}
                      onChange={(e) => setVariant(e.target.value)}
                      className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                    >
                      {candidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ab-split">
                    Traffic to version B: <b className="tabular-nums">{split}%</b>
                  </Label>
                  <input
                    id="ab-split"
                    type="range"
                    min={1}
                    max={99}
                    value={split}
                    onChange={(e) => setSplit(Number(e.target.value))}
                    className="accent-[var(--primary)]"
                  />
                </div>
                <div>
                  <Button type="submit" disabled={pending || !variant}>
                    <FlaskConical aria-hidden /> Start test
                  </Button>
                </div>
              </form>
            )
          ) : (
            <p className="text-muted-foreground text-sm">
              Only members who can publish can start a test.
            </p>
          )}

          {tests.length > 0 && (
            <ul className="flex flex-col gap-4">
              {tests.map((test) => (
                <li
                  key={test.id}
                  className="border-ink bg-card flex flex-col gap-3 rounded-lg border-[1.5px] p-4 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <b>{test.name}</b>
                    {test.status === "running" ? (
                      <span className="rounded-full bg-[var(--chip-live-bg)] px-2 py-0.5 text-[11.5px] font-bold text-[var(--chip-live-fg)]">
                        Running
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-[12.5px]">
                        Ended
                        {test.winner
                          ? ` · winner: version ${test.winner.toUpperCase()}`
                          : ""}
                      </span>
                    )}
                  </div>
                  <table className="w-full text-left">
                    <thead className="text-muted-foreground text-[12px]">
                      <tr>
                        <th className="pr-3 font-medium">Version</th>
                        <th className="pr-3 font-medium">Form</th>
                        <th className="pr-3 font-medium">Traffic</th>
                        <th className="pr-3 font-medium">Started</th>
                        <th className="pr-3 font-medium">Finished</th>
                        <th className="font-medium">Completion</th>
                      </tr>
                    </thead>
                    <tbody>
                      <ArmRow
                        label="A"
                        title={formTitle}
                        stats={test.arms.a}
                        share={100 - test.split}
                      />
                      <ArmRow
                        label="B"
                        title={test.variantTitle}
                        stats={test.arms.b}
                        share={test.split}
                      />
                    </tbody>
                  </table>
                  <p className="text-muted-foreground">{verdictText(test)}</p>
                  {test.status === "running" && canManage && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() => stop(test, "a")}
                      >
                        Keep A
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() => stop(test, "b")}
                      >
                        Choose B
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => stop(test, null)}
                      >
                        End without a winner
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SettingsSection>
  );
}
