"use client";

import { useState, useTransition } from "react";
import { toast } from "@/lib/toast";
import {
  setKioskPinAction,
  updateKioskAction,
} from "@/app/(form)/forms/[id]/(sections)/settings/actions";
import { SettingsSection } from "@/components/dashboard/account-settings";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * Kiosk mode (master spec F-15): one device collecting many responses —
 * a lobby tablet, an event stand. Publishers turn it on and set the
 * timings; the kiosk link is the form's link with `?kiosk=1`.
 */
export function FormKioskPanel({
  formId,
  kioskLink,
  initial,
  hasPin: initialHasPin,
  canManage,
}: {
  formId: string;
  kioskLink: string;
  initial: { resetSeconds: number; idleSeconds: number } | null;
  hasPin: boolean;
  canManage: boolean;
}) {
  const [enabled, setEnabled] = useState(initial !== null);
  const [resetSeconds, setResetSeconds] = useState(String(initial?.resetSeconds ?? 8));
  const [idleSeconds, setIdleSeconds] = useState(String(initial?.idleSeconds ?? 90));
  const [pin, setPin] = useState("");
  const [hasPin, setHasPin] = useState(initialHasPin);
  const [saving, startSaving] = useTransition();
  const [savingPin, startSavingPin] = useTransition();
  const disabled = !canManage;

  function save(on: boolean) {
    startSaving(async () => {
      const result = await updateKioskAction(
        formId,
        on
          ? { resetSeconds: Number(resetSeconds), idleSeconds: Number(idleSeconds) }
          : null,
      );
      if (result.ok) {
        setEnabled(on);
        toast.success(on ? "Kiosk mode is on." : "Kiosk mode is off.");
      } else {
        toast.error("Couldn't save that.", { description: result.message });
      }
    });
  }

  function savePin(next: string | null) {
    startSavingPin(async () => {
      const result = await setKioskPinAction(formId, next);
      if (result.ok) {
        setHasPin(next !== null);
        setPin("");
        toast.success(next ? "PIN saved." : "PIN removed.");
      } else {
        toast.error("Couldn't save the PIN.", { description: result.message });
      }
    });
  }

  return (
    <SettingsSection
      title="Kiosk mode"
      description="Collect responses on one shared device. Each person gets a fresh form; nothing they type stays on the device."
    >
      <div className="flex flex-col gap-5" data-testid="form-kiosk-panel">
        <label className="bg-background flex cursor-pointer items-start justify-between gap-4 rounded-sm px-3 py-2.5">
          <span className="flex flex-col gap-0.5">
            <b className="text-sm">Allow kiosk mode</b>
            <span className="text-muted-foreground text-[12.5px] leading-normal">
              {enabled
                ? "On: open the kiosk link on the device and tap Start."
                : "Off: the kiosk link opens the form as usual."}
            </span>
          </span>
          <Switch
            checked={enabled}
            disabled={disabled || saving}
            onCheckedChange={save}
            aria-label="Allow kiosk mode"
          />
        </label>
        {enabled && (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="kiosk-link">Kiosk link</Label>
              <div className="flex gap-2">
                <Input
                  id="kiosk-link"
                  readOnly
                  value={kioskLink}
                  className="font-mono text-[13px]"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    void navigator.clipboard
                      ?.writeText(kioskLink)
                      .then(() => toast.success("Link copied."))
                  }
                >
                  Copy
                </Button>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="kiosk-reset">Start over after submitting (seconds)</Label>
                <Input
                  id="kiosk-reset"
                  type="number"
                  min={3}
                  max={60}
                  value={resetSeconds}
                  disabled={disabled}
                  onChange={(e) => setResetSeconds(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="kiosk-idle">
                  Ask “Still there?” after (seconds idle)
                </Label>
                <Input
                  id="kiosk-idle"
                  type="number"
                  min={30}
                  max={900}
                  value={idleSeconds}
                  disabled={disabled}
                  onChange={(e) => setIdleSeconds(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Button
                type="button"
                disabled={disabled || saving}
                data-loading={saving || undefined}
                onClick={() => save(true)}
              >
                {saving && <ButtonSpinner />}
                Save timings
              </Button>
            </div>
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                savePin(pin);
              }}
            >
              <Label htmlFor="kiosk-pin-setting">
                {hasPin ? "New exit PIN" : "Exit PIN (optional)"}
              </Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="kiosk-pin-setting"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  maxLength={8}
                  value={pin}
                  disabled={disabled || savingPin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  className="h-[42px] w-full sm:w-40"
                />
                <Button
                  type="submit"
                  className="h-[42px]"
                  disabled={disabled || savingPin || pin.length < 4}
                >
                  {hasPin ? "Change PIN" : "Set PIN"}
                </Button>
                {hasPin && (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-[42px]"
                    disabled={disabled || savingPin}
                    onClick={() => savePin(null)}
                  >
                    Remove PIN
                  </Button>
                )}
              </div>
              <p
                className="text-muted-foreground text-xs leading-normal"
                data-testid="kiosk-pin-status"
              >
                {hasPin
                  ? "Leaving kiosk mode on the device asks for this PIN."
                  : "Without a PIN, anyone can leave kiosk mode from the corner button."}{" "}
                It doesn&apos;t lock the device itself: use its own setting for that
                (Guided Access on iPad, screen pinning on Android).
              </p>
            </form>
          </>
        )}
      </div>
    </SettingsSection>
  );
}
