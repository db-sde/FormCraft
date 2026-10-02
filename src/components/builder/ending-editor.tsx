"use client";

import { useState } from "react";
import type { EndingV1, FormSchemaV1 } from "@/domains/forms/schema/v1";
import { DEFAULT_REDIRECT_DELAY } from "@/domains/forms/redirect";
import { showsMadeWith } from "@/domains/forms/branding";
import { isSchedulerUrl } from "@/domains/forms/scheduler";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PANEL_INPUT, PanelField, SectionHead, SwitchRow } from "./panel-ui";

const DELAYS = [0, 3, 5, 10, 30];

function DelaySelect({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (seconds: number) => void;
  label: string;
}) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className="h-[38px] w-full" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {DELAYS.map((s) => (
          <SelectItem key={s} value={String(s)}>
            {s === 0 ? "Straight away" : `After ${s} seconds`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Settings for the selected ending (Part 4, right panel). Its title
 * and description are edited on the canvas. The form's default
 * redirect (P2.9) lives here too: it's what endings without their own
 * redirect do. */
export function EndingSettingsPanel({
  ending,
  onChange,
  meta,
  onMetaChange,
  brandingRemovable = true,
}: {
  brandingRemovable?: boolean;
  ending: EndingV1;
  onChange: (next: EndingV1) => void;
  meta?: FormSchemaV1["meta"];
  onMetaChange?: (next: FormSchemaV1["meta"]) => void;
}) {
  const fallback = meta?.defaultRedirect;
  // Typed text, so a half-written URL doesn't fail the whole draft's save:
  // only a valid https address is stored.
  const [defaultUrl, setDefaultUrl] = useState(fallback?.url ?? "");
  const defaultValid = /^https:\/\/[^\s/$.?#].[^\s]*$/i.test(defaultUrl);

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-4">
      <PanelField
        label="Redirect URL (optional)"
        hint={
          fallback && !ending.redirectUrl
            ? "Empty: uses the form's default redirect below."
            : "When set, people are taken to this page."
        }
      >
        <Input
          type="url"
          className={PANEL_INPUT}
          value={ending.redirectUrl ?? ""}
          placeholder="https://example.com/thanks"
          onChange={(e) =>
            onChange({ ...ending, redirectUrl: e.target.value || undefined })
          }
        />
      </PanelField>
      {ending.redirectUrl && (
        <PanelField label="Redirect">
          <DelaySelect
            label="When to redirect"
            value={ending.redirectDelaySeconds ?? DEFAULT_REDIRECT_DELAY}
            onChange={(redirectDelaySeconds) =>
              onChange({ ...ending, redirectDelaySeconds })
            }
          />
        </PanelField>
      )}
      <PanelField label="Button label" hint="Shown with a redirect.">
        <Input
          className={PANEL_INPUT}
          value={ending.buttonLabel ?? ""}
          placeholder="Continue"
          onChange={(e) => onChange({ ...ending, buttonLabel: e.target.value })}
        />
      </PanelField>
      <SchedulerField ending={ending} onChange={onChange} />
      <SwitchRow
        label="Show “Made with FormCraft”"
        hint={brandingRemovable ? undefined : "Removing it is part of paid plans."}
        checked={showsMadeWith(ending, brandingRemovable)}
        disabled={!brandingRemovable}
        onCheckedChange={(on) => onChange({ ...ending, showMadeWith: on })}
      />

      {meta && onMetaChange && (
        <>
          <SectionHead>Every ending</SectionHead>
          <PanelField
            label="Default redirect (optional)"
            hint={
              defaultUrl && !defaultValid
                ? "Use a full https:// address."
                : "For endings without their own redirect URL."
            }
          >
            <Input
              type="url"
              className={PANEL_INPUT}
              value={defaultUrl}
              placeholder="https://example.com/next"
              aria-invalid={!!defaultUrl && !defaultValid}
              onChange={(e) => {
                const url = e.target.value.trim();
                setDefaultUrl(e.target.value);
                if (!url) {
                  onMetaChange({ ...meta, defaultRedirect: undefined });
                } else if (/^https:\/\/[^\s/$.?#].[^\s]*$/i.test(url)) {
                  onMetaChange({
                    ...meta,
                    defaultRedirect: {
                      url,
                      delaySeconds: fallback?.delaySeconds ?? DEFAULT_REDIRECT_DELAY,
                    },
                  });
                }
              }}
            />
          </PanelField>
          {fallback && (
            <PanelField label="Default redirect">
              <DelaySelect
                label="When to use the default redirect"
                value={fallback.delaySeconds}
                onChange={(delaySeconds) =>
                  onMetaChange({
                    ...meta,
                    defaultRedirect: { ...fallback, delaySeconds },
                  })
                }
              />
            </PanelField>
          )}
        </>
      )}
    </div>
  );
}

/** A Calendly / Cal.com booking page on this ending (P2.16). Shown on the
 * live form only on plans with scheduling. */
function SchedulerField({
  ending,
  onChange,
}: {
  ending: EndingV1;
  onChange: (next: EndingV1) => void;
}) {
  const provider = ending.scheduler?.provider ?? "none";
  const [url, setUrl] = useState(ending.scheduler?.url ?? "");
  const valid = provider !== "none" && isSchedulerUrl(provider, url);
  return (
    <>
      <PanelField label="Booking page">
        <Select
          value={provider}
          onValueChange={(next) => {
            if (next === "none") onChange({ ...ending, scheduler: undefined });
            else if (isSchedulerUrl(next as "calendly" | "cal", url)) {
              onChange({
                ...ending,
                scheduler: { provider: next as "calendly" | "cal", url },
              });
            } else {
              onChange({ ...ending, scheduler: undefined });
            }
          }}
        >
          <SelectTrigger className="h-[38px] w-full" aria-label="Booking page">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="calendly">Calendly</SelectItem>
            <SelectItem value="cal">Cal.com</SelectItem>
          </SelectContent>
        </Select>
      </PanelField>
      <PanelField
        label="Booking link"
        hint={
          url && !valid
            ? "Use your Calendly or Cal.com link (https://calendly.com/… or https://cal.com/…)."
            : "Shown on this ending, filled in with their name and email. Paid plans."
        }
      >
        <Input
          type="url"
          className={PANEL_INPUT}
          value={url}
          placeholder="https://calendly.com/you/intro"
          onChange={(e) => {
            const next = e.target.value.trim();
            setUrl(e.target.value);
            const chosen: "calendly" | "cal" | null = /calendly\.com/.test(next)
              ? "calendly"
              : /cal\.com/.test(next)
                ? "cal"
                : null;
            if (chosen && isSchedulerUrl(chosen, next)) {
              onChange({ ...ending, scheduler: { provider: chosen, url: next } });
            } else if (!next) {
              onChange({ ...ending, scheduler: undefined });
            }
          }}
        />
      </PanelField>
    </>
  );
}
