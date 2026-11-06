"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast";
import {
  setCaptchaAction,
  setFormPasswordAction,
  updateAvailabilityAction,
} from "@/app/(form)/forms/[id]/(sections)/settings/actions";
import { SettingsSection } from "@/components/dashboard/account-settings";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_CLOSED_MESSAGE,
  DEFAULT_FULL_MESSAGE,
  MAX_MESSAGE_LENGTH,
  MAX_RESPONSE_CAP,
} from "@/domains/forms/availability";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/domains/forms/access-rules";

export type FormAccessSettings = {
  closesAt: string | null;
  closedMessage: string | null;
  responseCap: number | null;
  fullMessage: string | null;
  captchaRequired: boolean;
  passwordProtected: boolean;
  /** Completed responses that count towards the cap. */
  accepted: number;
};

/** An ISO time as a `datetime-local` value in this browser's zone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isPast(date: Date): boolean {
  return date.getTime() <= Date.now();
}

const subscribe = () => () => {};

const rowClass =
  "bg-background flex cursor-pointer items-start justify-between gap-4 rounded-sm px-3 py-2.5";
const hintClass = "text-muted-foreground text-[12.5px] leading-normal";

/**
 * Who can respond, and until when (master spec F-26, F-46, F-47, F-48):
 * close date, response limit, password and CAPTCHA. All four change the
 * live link at once, without republishing, so only people who may
 * publish can change them.
 */
export function FormAccessPanel({
  formId,
  initial,
  captchaAvailable,
  canManage,
}: {
  formId: string;
  initial: FormAccessSettings;
  /** The server has Turnstile keys. */
  captchaAvailable: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [saving, startSaving] = useTransition();
  const [savingPassword, startSavingPassword] = useTransition();
  const [savingCaptcha, startSavingCaptcha] = useTransition();

  // Dates are shown in the creator's own time zone, which the server
  // can't know: the server pass leaves them blank and the browser fills
  // them in (the LocalTime pattern).
  const isClient = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const zone = isClient ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";
  const [closesOn, setClosesOn] = useState(initial.closesAt !== null);
  // null until edited: shows the saved time.
  const [closesAtEdit, setClosesAt] = useState<string | null>(null);
  const closesAt =
    closesAtEdit ?? (isClient && initial.closesAt ? toLocalInput(initial.closesAt) : "");
  const [closedMessage, setClosedMessage] = useState(initial.closedMessage ?? "");
  const [capOn, setCapOn] = useState(initial.responseCap !== null);
  const [cap, setCap] = useState(initial.responseCap ? String(initial.responseCap) : "");
  const [fullMessage, setFullMessage] = useState(initial.fullMessage ?? "");

  const [password, setPassword] = useState("");
  const [protectedNow, setProtectedNow] = useState(initial.passwordProtected);
  const [captcha, setCaptcha] = useState(initial.captchaRequired);

  const closesTime = closesOn && closesAt ? new Date(closesAt) : null;
  const closedAlready = closesTime !== null && isPast(closesTime);
  const capNumber = capOn && /^\d+$/.test(cap) ? Number(cap) : null;
  const left = capNumber === null ? null : Math.max(0, capNumber - initial.accepted);

  function saveAvailability() {
    if (closesOn && (!closesTime || Number.isNaN(closesTime.getTime()))) {
      toast.error("Choose the date and time the form closes.");
      return;
    }
    if (capOn && (capNumber === null || capNumber < 1 || capNumber > MAX_RESPONSE_CAP)) {
      toast.error(
        `Set a limit between 1 and ${MAX_RESPONSE_CAP.toLocaleString("en-US")}.`,
      );
      return;
    }
    startSaving(async () => {
      const result = await updateAvailabilityAction(formId, {
        closesAt: closesOn && closesTime ? closesTime.toISOString() : null,
        closedMessage: closedMessage.trim() || null,
        responseCap: capOn ? capNumber : null,
        fullMessage: fullMessage.trim() || null,
      });
      if (result.ok) {
        toast.success("Saved.");
        router.refresh();
      } else {
        toast.error("Couldn't save that.", { description: result.message });
      }
    });
  }

  function savePassword(next: string | null) {
    startSavingPassword(async () => {
      const result = await setFormPasswordAction(formId, next);
      if (result.ok) {
        setProtectedNow(next !== null);
        setPassword("");
        toast.success(next === null ? "Password removed." : "Password saved.", {
          description:
            next === null
              ? "Anyone with the link can open the form again."
              : "People who used the old password will need the new one.",
        });
      } else {
        toast.error("Couldn't save the password.", { description: result.message });
      }
    });
  }

  function saveCaptcha(required: boolean) {
    setCaptcha(required);
    startSavingCaptcha(async () => {
      const result = await setCaptchaAction(formId, required);
      if (result.ok) {
        toast.success("Saved.");
      } else {
        setCaptcha(!required);
        toast.error("Couldn't save that.", { description: result.message });
      }
    });
  }

  const disabled = !canManage;

  return (
    <div className="flex flex-col gap-[26px]" data-testid="form-access-panel">
      <SettingsSection
        title="Closing"
        description={
          canManage
            ? "Stop taking responses at a set time or after a number of them. This applies to the live link and embeds at once, even for people who already have the form open."
            : "Only people who can publish this form can change these settings."
        }
      >
        <div className="flex flex-col gap-5">
          <label className={rowClass}>
            <span className="flex flex-col gap-0.5">
              <b className="text-sm">Close on a date</b>
              <span className={hintClass}>
                {closedAlready
                  ? "This time has passed: the form is closed now."
                  : "Submissions after this time are refused."}
              </span>
            </span>
            <Switch
              checked={closesOn}
              disabled={disabled || saving}
              onCheckedChange={setClosesOn}
              aria-label="Close on a date"
            />
          </label>
          {closesOn && (
            <div className="grid gap-1.5 sm:max-w-xs">
              <Label htmlFor="closes-at">Closes at</Label>
              <Input
                id="closes-at"
                type="datetime-local"
                value={closesAt}
                disabled={disabled || saving}
                onChange={(e) => setClosesAt(e.target.value)}
              />
              {zone && (
                <p className="text-muted-foreground text-xs">Your time zone: {zone}</p>
              )}
            </div>
          )}
          {closesOn && (
            <div className="grid gap-1.5">
              <Label htmlFor="closed-message">Message after closing</Label>
              <Textarea
                id="closed-message"
                value={closedMessage}
                maxLength={MAX_MESSAGE_LENGTH}
                placeholder={DEFAULT_CLOSED_MESSAGE}
                disabled={disabled || saving}
                onChange={(e) => setClosedMessage(e.target.value)}
              />
            </div>
          )}

          <label className={rowClass}>
            <span className="flex flex-col gap-0.5">
              <b className="text-sm">Limit the number of responses</b>
              <span className={hintClass}>
                {initial.accepted.toLocaleString("en-US")} submitted so far
                {left !== null && ` · ${left.toLocaleString("en-US")} left`}. Unfinished
                responses and suspected spam don&apos;t count.
              </span>
            </span>
            <Switch
              checked={capOn}
              disabled={disabled || saving}
              onCheckedChange={setCapOn}
              aria-label="Limit the number of responses"
            />
          </label>
          {capOn && (
            <div className="grid gap-1.5 sm:max-w-xs">
              <Label htmlFor="response-cap">Maximum responses</Label>
              <Input
                id="response-cap"
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_RESPONSE_CAP}
                value={cap}
                disabled={disabled || saving}
                onChange={(e) => setCap(e.target.value)}
              />
            </div>
          )}
          {capOn && (
            <div className="grid gap-1.5">
              <Label htmlFor="full-message">Message when full</Label>
              <Textarea
                id="full-message"
                value={fullMessage}
                maxLength={MAX_MESSAGE_LENGTH}
                placeholder={DEFAULT_FULL_MESSAGE}
                disabled={disabled || saving}
                onChange={(e) => setFullMessage(e.target.value)}
              />
            </div>
          )}
          <div>
            <Button
              onClick={saveAvailability}
              disabled={disabled || saving}
              data-loading={saving || undefined}
            >
              {saving && <ButtonSpinner />}
              Save closing settings
            </Button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Password"
        description="People must enter a shared password before they see any question. It shows someone was given the password, not who they are."
      >
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            savePassword(password);
          }}
        >
          <p className="text-sm" data-testid="password-status">
            {protectedNow
              ? "On: the form asks for a password."
              : "Off: anyone with the link can open the form."}
          </p>
          <Label htmlFor="form-password">
            {protectedNow ? "New password" : "Password"}
          </Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="form-password"
              type="password"
              autoComplete="new-password"
              value={password}
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_MAX_LENGTH}
              disabled={disabled || savingPassword}
              onChange={(e) => setPassword(e.target.value)}
              className="h-[42px] w-full sm:w-64"
            />
            <Button
              type="submit"
              className="h-[42px]"
              disabled={
                disabled || savingPassword || password.length < PASSWORD_MIN_LENGTH
              }
              data-loading={savingPassword || undefined}
            >
              {savingPassword && <ButtonSpinner />}
              {protectedNow ? "Change password" : "Set password"}
            </Button>
            {protectedNow && (
              <Button
                type="button"
                variant="outline"
                className="h-[42px]"
                disabled={disabled || savingPassword}
                onClick={() => savePassword(null)}
              >
                Remove password
              </Button>
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            At least {PASSWORD_MIN_LENGTH} characters. Changing it locks out everyone who
            used the old one.
          </p>
        </form>
      </SettingsSection>

      <SettingsSection
        title="Spam protection"
        description="The hidden spam trap and rate limits are always on. A CAPTCHA adds a check most people never notice."
      >
        <label className={rowClass}>
          <span className="flex flex-col gap-0.5">
            <b className="text-sm">Require a CAPTCHA to submit</b>
            <span className={hintClass}>
              {captchaAvailable
                ? "Uses Cloudflare Turnstile. If the check can't run, the submission is refused and the person can try again; their answers stay saved."
                : "The bot check is almost here. We're putting the finishing touches on it, and it'll switch on right here when it's ready."}
            </span>
          </span>
          <Switch
            checked={captcha}
            disabled={disabled || savingCaptcha || (!captchaAvailable && !captcha)}
            onCheckedChange={saveCaptcha}
            aria-label="Require a CAPTCHA to submit"
          />
        </label>
      </SettingsSection>
    </div>
  );
}
