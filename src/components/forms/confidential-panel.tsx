"use client";

import { useState, useTransition } from "react";
import { setConfidentialAction } from "@/app/(form)/forms/[id]/(sections)/settings/actions";
import {
  DEFAULT_THRESHOLD,
  type ConfidentialSettings,
} from "@/domains/responses/feedback-report";
import { SettingsSection } from "@/components/dashboard/account-settings";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/toast";

/** Confidential feedback, e.g. a 360 review (F-30). */
export function ConfidentialPanel({
  formId,
  initial,
  hasResponses,
  groupQuestions,
  canManage,
}: {
  formId: string;
  initial: ConfidentialSettings | null;
  hasResponses: boolean;
  groupQuestions: { id: string; label: string }[];
  canManage: boolean;
}) {
  const [settings, setSettings] = useState<ConfidentialSettings>(
    initial ?? { threshold: DEFAULT_THRESHOLD, groupQuestionId: groupQuestions[0]?.id },
  );
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const locked = Boolean(initial && hasResponses);
  const save = (next: ConfidentialSettings | null, done: string) =>
    start(async () => {
      const result = await setConfidentialAction(formId, next);
      if (result.ok) {
        toast.success(done);
        setConfirming(false);
      } else toast.error(result.message);
    });

  return (
    <SettingsSection
      title="Confidential feedback (360)"
      description="For reviews where raters must stay anonymous. Nobody — owners included — can open individual responses or export them, and integrations that send answers out stay off. Responses shows a report of averages, with groups of raters smaller than the threshold never shown on their own."
      wide
    >
      <div className="flex flex-col gap-3">
        {initial ? (
          <p className="text-sm">
            <b>On.</b> Groups under {initial.threshold} raters aren&apos;t shown on their
            own.
            {locked && " This form has responses, so it stays confidential."}
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">
            Off: responses are visible as usual.
          </p>
        )}
        {canManage && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confidential-threshold">Smallest group shown</Label>
              <Input
                id="confidential-threshold"
                type="number"
                min={initial && locked ? initial.threshold : 2}
                max={50}
                className="h-9 w-24"
                value={settings.threshold}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    threshold: Math.round(Number(e.target.value)),
                  }))
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confidential-group">Rater group question</Label>
              <select
                id="confidential-group"
                className="border-input bg-field h-9 max-w-[280px] rounded-sm border-[1.5px] px-2 text-sm"
                value={settings.groupQuestionId ?? ""}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    groupQuestionId: e.target.value || undefined,
                  }))
                }
              >
                <option value="">No groups (overall only)</option>
                {groupQuestions.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.label}
                  </option>
                ))}
              </select>
            </div>
            {initial ? (
              <>
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => save(settings, "Saved.")}
                >
                  {pending && <ButtonSpinner />}
                  Save
                </Button>
                {!locked && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => save(null, "Responses are visible as usual.")}
                  >
                    Turn off
                  </Button>
                )}
              </>
            ) : confirming ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm">
                  Once responses come in, this can&apos;t be turned off.
                </span>
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    save(settings, "This form's responses are now confidential.")
                  }
                >
                  {pending && <ButtonSpinner />}
                  Make confidential
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
                Make responses confidential
              </Button>
            )}
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
