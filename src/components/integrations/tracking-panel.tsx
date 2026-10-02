"use client";

import { useState, useTransition } from "react";
import { saveTrackingAction } from "@/app/(form)/forms/[id]/(sections)/integrations/actions";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/toast";

/** Analytics and ad pixels (P2.12): only the IDs; FormCraft adds the
 * official snippet for each on the live form. */
export function TrackingPanel({
  formId,
  initial,
  allowed,
}: {
  formId: string;
  initial: { gaMeasurementId: string; gtmContainerId: string; metaPixelId: string };
  allowed: boolean;
}) {
  const [values, setValues] = useState(initial);
  const [pending, start] = useTransition();
  const hasAny = Object.values(initial).some(Boolean);

  if (!allowed && !hasAny) {
    return (
      <p className="text-muted-foreground text-sm">
        Analytics and ad pixels are part of paid plans. See Settings → Plan.
      </p>
    );
  }

  const field = (key: keyof typeof values, label: string, placeholder: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`tracking-${key}`}>{label}</Label>
      <Input
        id={`tracking-${key}`}
        value={values[key]}
        placeholder={placeholder}
        onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
      />
    </div>
  );

  return (
    <form
      className="flex flex-col gap-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await saveTrackingAction(formId, values);
          if (result.ok) toast.success("Saved.");
          else toast.error(result.message);
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {field("gaMeasurementId", "Google Analytics 4", "G-XXXXXXX")}
        {field("gtmContainerId", "Google Tag Manager", "GTM-XXXXXX")}
        {field("metaPixelId", "Meta Pixel", "123456789012345")}
      </div>
      <p className="text-muted-foreground text-xs leading-normal">
        These load only on the live form (never in Preview) and send page views, starts
        and submissions — no answers. They set cookies and share visits with Google or
        Meta: say so in your privacy notice, and ask for consent where the law requires
        it.
      </p>
      <Button type="submit" className="self-start" disabled={pending}>
        {pending && <ButtonSpinner />}
        Save
      </Button>
    </form>
  );
}
