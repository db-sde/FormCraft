"use client";

import { useId, useState } from "react";
import type { QuestionV1 } from "@/domains/forms/schema/v1";
import { TIME_STEPS } from "@/domains/forms/schema/v1";
import {
  ADDRESS_FIELDS,
  ADDRESS_FIELD_LABELS,
  type AddressField,
} from "@/domains/forms/schema/question-types";
import { isValidTimeZone } from "@/domains/logic/datetime";
import {
  PERSONAL_PREFILL_TYPES,
  PREFILL_KEY_PATTERN,
  RESERVED_URL_PARAMS,
  supportsPrefill,
} from "@/domains/forms/prefill";
import { profileKeyFromLabel } from "@/domains/responses/profile";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "cn";
import { OptionsEditor } from "./options-editor";
import { ImageUploadField } from "./image-upload-field";
import {
  PANEL_INPUT,
  PanelField,
  PanelNote,
  SectionHead,
  Segmented,
  SwitchRow,
} from "./panel-ui";

type Change = (next: QuestionV1) => void;

// --- time and date-time (F-20) ----------------------------------------------

export function TimeSettingsPanel({
  question,
  onChange,
}: {
  question: Extract<QuestionV1, { type: "time" | "datetime" }>;
  onChange: Change;
}) {
  const zoneList = useId();
  const [zoneDraft, setZoneDraft] = useState(
    question.type === "datetime" ? (question.settings.timeZone ?? "") : "",
  );
  const set = (patch: Record<string, unknown>) =>
    onChange({ ...question, settings: { ...question.settings, ...patch } } as QuestionV1);
  const zones =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [];

  return (
    <>
      {question.type === "datetime" && (
        <>
          <SectionHead>Dates</SectionHead>
          <PanelField label="Earliest date" half>
            <Input
              className={PANEL_INPUT}
              type="date"
              value={question.settings.minDate ?? ""}
              onChange={(e) => set({ minDate: e.target.value || undefined })}
            />
          </PanelField>
          <PanelField label="Latest date" half>
            <Input
              className={PANEL_INPUT}
              type="date"
              value={question.settings.maxDate ?? ""}
              onChange={(e) => set({ maxDate: e.target.value || undefined })}
            />
          </PanelField>
        </>
      )}
      <SectionHead>Times</SectionHead>
      <PanelField label="Earliest" half>
        <Input
          className={PANEL_INPUT}
          type="time"
          value={question.settings.minTime ?? ""}
          onChange={(e) => set({ minTime: e.target.value || undefined })}
        />
      </PanelField>
      <PanelField label="Latest" half>
        <Input
          className={PANEL_INPUT}
          type="time"
          value={question.settings.maxTime ?? ""}
          onChange={(e) => set({ maxTime: e.target.value || undefined })}
        />
      </PanelField>
      <PanelField label="Every" half hint="The gap between times offered.">
        <Select
          value={String(question.settings.stepMinutes ?? 5)}
          onValueChange={(value) => set({ stepMinutes: Number(value) })}
        >
          <SelectTrigger className="h-[38px] w-full" aria-label="Minutes between times">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIME_STEPS.map((step) => (
              <SelectItem key={step} value={String(step)}>
                {step === 60 ? "1 hour" : `${step} min`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PanelField>
      <div className="col-span-1">
        <Segmented
          label="Clock"
          value={question.settings.hourCycle ?? "24"}
          options={[
            { value: "12", label: "12 h" },
            { value: "24", label: "24 h" },
          ]}
          onChange={(value) => set({ hourCycle: value })}
        />
      </div>
      {question.type === "datetime" && (
        <PanelField
          label="Time zone"
          hint={
            zoneDraft && !isValidTimeZone(zoneDraft)
              ? "Not a time zone we know. Pick one from the list, like Asia/Kolkata."
              : zoneDraft
                ? "Times are in this zone for everyone (say, an event's venue)."
                : "Empty: each respondent's own zone. Every answer is saved with its UTC offset."
          }
        >
          <Input
            className={PANEL_INPUT}
            list={zoneList}
            placeholder="Respondent's own"
            value={zoneDraft}
            onChange={(e) => {
              const value = e.target.value.trim();
              setZoneDraft(value);
              if (!value) set({ timeZone: undefined });
              else if (isValidTimeZone(value)) set({ timeZone: value });
            }}
          />
          <datalist id={zoneList}>
            {zones.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        </PanelField>
      )}
      <PanelNote>
        Answers are stored as 24-hour times
        {question.type === "datetime" ? " with their UTC offset" : ""}, whatever the clock
        shows.
      </PanelNote>
    </>
  );
}

// --- address (F-13) -------------------------------------------------------------

export function AddressSettingsPanel({
  question,
  onChange,
}: {
  question: Extract<QuestionV1, { type: "address" }>;
  onChange: Change;
}) {
  const { fields, requiredFields } = question.settings;
  function update(nextFields: AddressField[], nextRequired: AddressField[]) {
    const ordered = ADDRESS_FIELDS.filter((f) => nextFields.includes(f));
    const required = ordered.filter((f) => nextRequired.includes(f));
    onChange({
      ...question,
      required: required.length > 0,
      settings: { fields: ordered, requiredFields: required },
    });
  }
  return (
    <>
      <SectionHead>Address parts</SectionHead>
      <div className="col-span-full flex flex-col gap-2">
        <p className="text-muted-foreground text-[12.5px]">
          No part assumes a country&apos;s format: not every country has a state or a
          fixed-length postcode.
        </p>
        <div className="divide-border border-border bg-card divide-y overflow-hidden rounded-sm border-[1.5px]">
          {ADDRESS_FIELDS.map((field) => {
            const shown = fields.includes(field);
            const onlyOne = shown && fields.length === 1;
            return (
              <div
                key={field}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Checkbox
                    checked={shown}
                    disabled={onlyOne}
                    onCheckedChange={(checked) =>
                      update(
                        checked ? [...fields, field] : fields.filter((f) => f !== field),
                        requiredFields.filter((f) => f !== field || checked),
                      )
                    }
                  />
                  {ADDRESS_FIELD_LABELS[field]}
                </label>
                <label
                  aria-disabled={!shown}
                  className={cn(
                    "text-muted-foreground flex items-center gap-2 text-xs",
                    !shown && "opacity-40",
                  )}
                >
                  Required
                  <Switch
                    size="sm"
                    disabled={!shown}
                    checked={requiredFields.includes(field)}
                    onCheckedChange={(checked) =>
                      update(
                        fields,
                        checked
                          ? [...requiredFields, field]
                          : requiredFields.filter((f) => f !== field),
                      )
                    }
                  />
                </label>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// --- ranking (F-18) -----------------------------------------------------------------

export function RankingSettingsPanel({
  question,
  onChange,
}: {
  question: Extract<QuestionV1, { type: "ranking" }>;
  onChange: Change;
}) {
  const { options, rankCount } = question.settings;
  return (
    <>
      <SectionHead>Options</SectionHead>
      <PanelField label="Options to rank">
        <OptionsEditor
          options={options}
          minCount={2}
          maxCount={20}
          keys={false}
          onChange={(next) =>
            onChange({
              ...question,
              settings: {
                ...question.settings,
                options: next,
                rankCount:
                  rankCount !== undefined && rankCount >= next.length
                    ? undefined
                    : rankCount,
              },
            })
          }
        />
      </PanelField>
      <PanelField label="Respondents rank" hint="Answers must rank exactly this many.">
        <Select
          value={rankCount === undefined ? "all" : String(rankCount)}
          onValueChange={(value) =>
            onChange({
              ...question,
              settings: {
                ...question.settings,
                rankCount: value === "all" ? undefined : Number(value),
              },
            })
          }
        >
          <SelectTrigger className="h-[38px] w-full" aria-label="How many to rank">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All of them</SelectItem>
            {Array.from({ length: options.length - 1 }, (_, i) => i + 1).map((n) => (
              <SelectItem key={n} value={String(n)}>
                Their top {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PanelField>
      <SwitchRow
        label="Shuffle options"
        hint="Each respondent starts from a different order"
        checked={!!question.settings.randomizeOptions}
        onCheckedChange={(randomizeOptions) =>
          onChange({ ...question, settings: { ...question.settings, randomizeOptions } })
        }
      />
    </>
  );
}

// --- matrix (F-11) ----------------------------------------------------------------------

export function MatrixSettingsPanel({
  question,
  onChange,
}: {
  question: Extract<QuestionV1, { type: "matrix" }>;
  onChange: Change;
}) {
  const set = (patch: Partial<typeof question.settings>) =>
    onChange({ ...question, settings: { ...question.settings, ...patch } });
  return (
    <>
      <SectionHead>Rows</SectionHead>
      <PanelField label="Rows" hint="What's being rated, one per row.">
        <OptionsEditor
          options={question.settings.rows}
          noun="Row"
          minCount={1}
          maxCount={30}
          keys={false}
          onChange={(rows) => set({ rows })}
        />
      </PanelField>
      <SectionHead>Columns</SectionHead>
      <PanelField label="Columns" hint="The same choices for every row.">
        <OptionsEditor
          options={question.settings.columns}
          noun="Column"
          minCount={2}
          maxCount={10}
          keys={false}
          onChange={(columns) => set({ columns })}
        />
      </PanelField>
      <SwitchRow
        label="Several per row"
        hint={
          question.settings.multiple ? "Checkboxes: any number per row" : "One per row"
        }
        checked={question.settings.multiple}
        onCheckedChange={(multiple) => set({ multiple })}
      />
      <PanelNote>
        Required means every row needs an answer. Exports give each row its own column.
      </PanelNote>
    </>
  );
}

// --- picture choice (F-12) -----------------------------------------------------------------

export function PictureOptionsEditor({
  question,
  onChange,
  workspaceId,
  formId,
}: {
  question: Extract<QuestionV1, { type: "single_select" | "multi_select" }>;
  onChange: Change;
  workspaceId: string;
  formId: string;
}) {
  const options = question.settings.options;
  const patch = (id: string, change: { imageUrl?: string; imageAlt?: string }) =>
    onChange({
      ...question,
      settings: {
        ...question.settings,
        options: options.map((o) => (o.id === id ? { ...o, ...change } : o)),
      },
    } as QuestionV1);
  return (
    <div className="col-span-full flex flex-col gap-3">
      {options.map((option, i) => (
        <div key={option.id} className="border-border flex flex-col gap-2 border-t pt-3">
          <ImageUploadField
            label={`${String.fromCharCode(65 + i)} · ${option.label || "Untitled"}`}
            noun="a picture"
            workspaceId={workspaceId}
            formId={formId}
            value={option.imageUrl}
            onChange={(imageUrl) =>
              patch(option.id, {
                imageUrl,
                imageAlt: imageUrl ? option.imageAlt : undefined,
              })
            }
          />
          {option.imageUrl && (
            <Input
              className={PANEL_INPUT}
              aria-label={`Picture description for ${option.label}`}
              placeholder="What the picture shows, for screen readers"
              maxLength={300}
              value={option.imageAlt ?? ""}
              onChange={(e) =>
                patch(option.id, { imageAlt: e.target.value || undefined })
              }
            />
          )}
        </div>
      ))}
      <p className="text-muted-foreground text-[12px]">
        An option without a picture shows a plain card with its label. Answers and exports
        use the labels.
      </p>
    </div>
  );
}

// --- link prefill (F-28) ------------------------------------------------------------------------

export function PrefillSetting({
  question,
  onChange,
}: {
  question: QuestionV1;
  onChange: Change;
}) {
  if (!supportsPrefill(question)) return null;
  const key = question.prefillKey;
  const personal = PERSONAL_PREFILL_TYPES.has(question.type);
  return (
    <>
      <SwitchRow
        label="Fill from the link"
        hint="Add a value to the form's link and it's filled in here. People can still change it."
        checked={!!key}
        onCheckedChange={(on) => {
          let next = on ? profileKeyFromLabel(question.label) : undefined;
          if (next && RESERVED_URL_PARAMS.has(next)) next = `${next}_answer`;
          onChange({ ...question, prefillKey: next } as QuestionV1);
        }}
      />
      {key && (
        <PanelField
          label="Link name"
          hint={
            <>
              Use <code className="font-mono">?{key}=…</code> on the link.
              {personal &&
                " Links end up in browser history and server logs, so avoid this for personal details unless you need it."}
            </>
          }
        >
          <Input
            className={PANEL_INPUT}
            aria-label="Link name"
            value={key}
            maxLength={40}
            onChange={(e) => {
              const value = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "");
              if (PREFILL_KEY_PATTERN.test(value))
                onChange({ ...question, prefillKey: value } as QuestionV1);
            }}
          />
        </PanelField>
      )}
    </>
  );
}
