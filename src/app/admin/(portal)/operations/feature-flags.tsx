"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setFeatureFlagAction } from "../../actions";
import { FLAG_LABEL, type FeatureFlag } from "@/domains/flag-labels";

export type FlagRow = { key: FeatureFlag; enabled: boolean; reason: string | null };
export type OverrideRow = {
  workspace_id: string;
  workspace: string;
  key: FeatureFlag;
  enabled: boolean;
  reason: string | null;
};

/** Feature switches (kill switches): on or off for every customer, or
 * for one workspace. Changes apply within 30 seconds. */
export function FeatureFlags({
  flags,
  overrides,
  canChange,
}: {
  flags: FlagRow[];
  overrides: OverrideRow[];
  canChange: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");

  function change(key: FeatureFlag, enabled: boolean | null, ws: string | null) {
    start(async () => {
      const result = await setFeatureFlagAction({
        key,
        enabled,
        workspaceId: ws,
        reason,
      });
      if (result.ok) {
        toast.success("Switch changed. It applies within 30 seconds.");
        router.refresh();
      } else toast.error(result.error);
    });
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="feature-switches">
      <h2 id="feature-switches" className="font-semibold">
        Feature switches
      </h2>
      <ul className="border-border divide-border divide-y rounded-lg border-[1.5px] text-sm">
        {flags.map((f) => (
          <li key={f.key} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <span className="min-w-[220px] font-semibold">{FLAG_LABEL[f.key]}</span>
            <span
              className={f.enabled ? "" : "font-semibold text-[var(--alert-error-fg)]"}
            >
              {f.enabled ? "On for everyone" : "Off for everyone"}
            </span>
            {f.reason && (
              <span className="text-muted-foreground text-xs">{f.reason}</span>
            )}
            <span className="flex-1" />
            {canChange && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => change(f.key, !f.enabled, null)}
                >
                  {f.enabled ? "Turn off for everyone" : "Turn on for everyone"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending || !workspaceId}
                  onClick={() => change(f.key, false, workspaceId)}
                >
                  Off for workspace
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending || !workspaceId}
                  onClick={() => change(f.key, true, workspaceId)}
                >
                  On for workspace
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      {canChange && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            aria-label="Reason"
            placeholder="Reason (needed for every change)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Input
            aria-label="Workspace id"
            placeholder="Workspace id (for one workspace only)"
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value.trim())}
          />
        </div>
      )}
      {overrides.length > 0 && (
        <ul className="text-sm">
          {overrides.map((o) => (
            <li
              key={`${o.workspace_id}-${o.key}`}
              className="flex flex-wrap items-center gap-2 py-1"
            >
              <b>{o.workspace}</b> · {FLAG_LABEL[o.key]}: {o.enabled ? "on" : "off"}
              {o.reason && (
                <span className="text-muted-foreground text-xs">({o.reason})</span>
              )}
              {canChange && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => change(o.key, null, o.workspace_id)}
                >
                  Clear
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
