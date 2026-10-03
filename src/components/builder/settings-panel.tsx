"use client";

import type { QuestionV1 } from "@/domains/forms/schema/v1";
import { OptionsEditor } from "./options-editor";
import { ImageUploadField } from "./image-upload-field";
import { ADDABLE_QUESTION_TYPES, QUESTION_TYPE_META, TypeTile } from "./question-meta";
import {
  ChipToggles,
  PANEL_INPUT,
  PanelField,
  PanelNote,
  SectionHead,
  Segmented,
  SwitchRow,
} from "./panel-ui";
import type { QuestionType } from "@/domains/forms/schema/question-types";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "cn";
import {
  CONTACT_FIELDS,
  CONTACT_FIELD_LABELS,
  type ContactField,
} from "@/domains/forms/schema/question-types";

/** Accepted-file chips → the MIME patterns uploads are checked against.
 * Only types the server can verify from the file's bytes are offered. */
const FILE_KINDS = [
  { label: "Images", mime: "image/*" },
  { label: "PDF", mime: "application/pdf" },
] as const;

const num = (v: string) => (v === "" ? undefined : Number(v));

/** Type-specific settings for the selected question (Part 4, right
 * panel). `onChange` receives a fully-formed replacement question (the
 * caller owns persisting it) — kept as one function rather than
 * per-field setters so each branch can update `settings` immutably
 * without a generic/unsafe partial-merge helper fighting the
 * discriminated union. */
export function SettingsPanel({
  question,
  onChange,
  onChangeType,
  workspaceId,
  formId,
  invalid = false,
  earlierChoices = [],
}: {
  /** Earlier choice questions this one could take its options from. */
  earlierChoices?: { id: string; number: number; label: string }[];
  /** For uploading a welcome/statement image. */
  workspaceId: string;
  formId: string;
  question: QuestionV1;
  onChange: (next: QuestionV1) => void;
  /** Convert to another type (the builder confirms lossy changes). */
  onChangeType?: (type: QuestionType) => void;
  /** Outline the fields involved in a "Not saved" problem. */
  invalid?: boolean;
}) {
  const bad = invalid ? "border-destructive" : "";

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-4">
      {question.type !== "welcome_screen" && onChangeType && (
        <PanelField label="Question type">
          <Select
            value={question.type}
            onValueChange={(value) => onChangeType(value as QuestionType)}
          >
            <SelectTrigger className="h-[38px] w-full" aria-label="Question type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ADDABLE_QUESTION_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  <TypeTile type={type} size={22} />
                  {QUESTION_TYPE_META[type].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PanelField>
      )}

      {question.type !== "welcome_screen" &&
        question.type !== "statement" &&
        question.type !== "contact_info" && (
          <SwitchRow
            label="Required"
            hint="Respondents can't skip it"
            checked={question.required}
            onCheckedChange={(required) => onChange({ ...question, required })}
          />
        )}

      {(question.type === "welcome_screen" || question.type === "statement") && (
        <>
          <PanelField label="Button label">
            <Input
              className={PANEL_INPUT}
              value={question.settings.buttonLabel ?? ""}
              placeholder={question.type === "welcome_screen" ? "Start" : "Continue"}
              onChange={(e) =>
                onChange({
                  ...question,
                  settings: { ...question.settings, buttonLabel: e.target.value },
                })
              }
            />
          </PanelField>
          <SectionHead>Image</SectionHead>
          <ImageUploadField
            label="Image (optional)"
            noun="an image"
            workspaceId={workspaceId}
            formId={formId}
            value={question.settings.imageUrl}
            onChange={(imageUrl) =>
              onChange({ ...question, settings: { ...question.settings, imageUrl } })
            }
          />
          {question.settings.imageUrl && (
            <PanelField label="Image description (alt text)">
              <Input
                className={PANEL_INPUT}
                value={question.settings.imageAlt ?? ""}
                placeholder="What the image shows, for screen readers"
                maxLength={300}
                onChange={(e) =>
                  onChange({
                    ...question,
                    settings: {
                      ...question.settings,
                      imageAlt: e.target.value || undefined,
                    },
                  })
                }
              />
            </PanelField>
          )}
        </>
      )}

      {question.type === "short_text" && (
        <>
          <SectionHead>Answer</SectionHead>
          <PanelField label="Placeholder">
            <Input
              className={PANEL_INPUT}
              value={question.settings.placeholder ?? ""}
              placeholder="Type your answer here…"
              onChange={(e) =>
                onChange({
                  ...question,
                  settings: { ...question.settings, placeholder: e.target.value },
                })
              }
            />
          </PanelField>
          <PanelField label="Min length" half>
            <Input
              className={cn(PANEL_INPUT, bad)}
              type="number"
              min={0}
              value={question.settings.minLength ?? ""}
              onChange={(e) =>
                onChange({
                  ...question,
                  settings: { ...question.settings, minLength: num(e.target.value) },
                })
              }
            />
          </PanelField>
          <PanelField label="Max length" half>
            <Input
              className={cn(PANEL_INPUT, bad)}
              type="number"
              min={1}
              value={question.settings.maxLength ?? ""}
              onChange={(e) =>
                onChange({
                  ...question,
                  settings: { ...question.settings, maxLength: num(e.target.value) },
                })
              }
            />
          </PanelField>
        </>
      )}

      {question.type === "long_text" && (
        <>
          <SectionHead>Answer</SectionHead>
          <PanelField label="Placeholder">
            <Input
              className={PANEL_INPUT}
              value={question.settings.placeholder ?? ""}
              placeholder="Type your answer here…"
              onChange={(e) =>
                onChange({
                  ...question,
                  settings: { ...question.settings, placeholder: e.target.value },
                })
              }
            />
          </PanelField>
          <PanelField label="Max length" hint="Characters. Leave empty for no limit.">
            <Input
              className={PANEL_INPUT}
              type="number"
              min={1}
              value={question.settings.maxLength ?? ""}
              onChange={(e) =>
                onChange({
                  ...question,
                  settings: { ...question.settings, maxLength: num(e.target.value) },
                })
              }
            />
          </PanelField>
          <SwitchRow
            label="AI follow-up"
            hint="Ask one optional follow-up about what they wrote. Uses an AI credit each time; their answer is sent to the AI."
            checked={question.settings.aiFollowUp ?? false}
            onCheckedChange={(aiFollowUp) =>
              onChange({
                ...question,
                settings: { ...question.settings, aiFollowUp: aiFollowUp || undefined },
              })
            }
          />
        </>
      )}

      {question.type === "contact_info" && (
        <ContactInfoSettings question={question} onChange={onChange} />
      )}

      {question.type === "email" && (
        <PanelNote>
          Answers are checked automatically to make sure they look like an email address.
        </PanelNote>
      )}
      {question.type === "url" && (
        <PanelNote>
          Answers are checked automatically to make sure they look like a web address.
          “example.com” is fine.
        </PanelNote>
      )}

      {question.type === "phone" && (
        <>
          <SectionHead>Answer</SectionHead>
          <PanelField
            label="Default country"
            hint="Two-letter code, like US or GB. Used when people leave out the +."
          >
            <Input
              className={cn(PANEL_INPUT, "uppercase")}
              placeholder="US"
              maxLength={2}
              value={question.settings.defaultCountry ?? ""}
              onChange={(e) =>
                onChange({
                  ...question,
                  settings: {
                    ...question.settings,
                    defaultCountry: e.target.value.toUpperCase() || undefined,
                  },
                })
              }
            />
          </PanelField>
        </>
      )}

      {question.type === "number" && (
        <>
          <SectionHead>Answer</SectionHead>
          <PanelField label="Min" half>
            <Input
              className={cn(PANEL_INPUT, bad)}
              type="number"
              value={question.settings.min ?? ""}
              onChange={(e) =>
                onChange({
                  ...question,
                  settings: { ...question.settings, min: num(e.target.value) },
                })
              }
            />
          </PanelField>
          <PanelField label="Max" half>
            <Input
              className={cn(PANEL_INPUT, bad)}
              type="number"
              value={question.settings.max ?? ""}
              onChange={(e) =>
                onChange({
                  ...question,
                  settings: { ...question.settings, max: num(e.target.value) },
                })
              }
            />
          </PanelField>
          <PanelField label="Decimal places">
            <Select
              value={
                question.settings.decimals === undefined
                  ? "any"
                  : String(question.settings.decimals)
              }
              onValueChange={(value) =>
                onChange({
                  ...question,
                  settings: {
                    ...question.settings,
                    decimals: value === "any" ? undefined : Number(value),
                  },
                })
              }
            >
              <SelectTrigger className="h-[38px] w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                <SelectItem value="0">Whole numbers only</SelectItem>
                <SelectItem value="1">Up to 1</SelectItem>
                <SelectItem value="2">Up to 2</SelectItem>
                <SelectItem value="3">Up to 3</SelectItem>
              </SelectContent>
            </Select>
          </PanelField>
        </>
      )}

      {(question.type === "single_select" ||
        question.type === "multi_select" ||
        question.type === "dropdown") && (
        <>
          <SectionHead>Choices</SectionHead>
          {earlierChoices.length > 0 && (
            <PanelField
              label="Options come from"
              hint={
                question.settings.optionsFrom
                  ? "People see only what applies to them; if nothing does, the question is skipped."
                  : undefined
              }
            >
              <Select
                value={
                  question.settings.optionsFrom
                    ? `${question.settings.optionsFrom.include}:${question.settings.optionsFrom.questionId}`
                    : "own"
                }
                onValueChange={(value) => {
                  const settings = { ...question.settings };
                  if (value === "own") {
                    delete settings.optionsFrom;
                  } else {
                    const [include, questionId] = value.split(/:(.+)/) as [
                      "selected" | "not_selected",
                      string,
                    ];
                    settings.optionsFrom = { questionId, include };
                  }
                  onChange({ ...question, settings } as QuestionV1);
                }}
              >
                <SelectTrigger className="h-[38px] w-full" aria-label="Options come from">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="own">This question&apos;s own list</SelectItem>
                  {earlierChoices.flatMap((c) => [
                    <SelectItem key={`s-${c.id}`} value={`selected:${c.id}`}>
                      What they picked in {c.number} · {c.label.slice(0, 24)}
                    </SelectItem>,
                    <SelectItem key={`n-${c.id}`} value={`not_selected:${c.id}`}>
                      What they didn&apos;t pick in {c.number} · {c.label.slice(0, 24)}
                    </SelectItem>,
                  ])}
                </SelectContent>
              </Select>
            </PanelField>
          )}
          {question.settings.optionsFrom ? (
            <p className="text-muted-foreground col-span-full text-[12.5px]">
              Options are kept in step with question{" "}
              {earlierChoices.find(
                (c) => c.id === question.settings.optionsFrom?.questionId,
              )?.number ?? "?"}
              : edit them there.
            </p>
          ) : (
            <PanelField label="Options">
              <OptionsEditor
                options={question.settings.options}
                onChange={(options) =>
                  onChange({
                    ...question,
                    settings: { ...question.settings, options },
                  } as QuestionV1)
                }
              />
            </PanelField>
          )}
          <SwitchRow
            label="Shuffle options"
            hint="Each respondent sees them in a different order"
            checked={!!question.settings.randomizeOptions}
            onCheckedChange={(randomizeOptions) =>
              onChange({
                ...question,
                settings: { ...question.settings, randomizeOptions },
              } as QuestionV1)
            }
          />
          {question.type !== "dropdown" && (
            <SwitchRow
              label="Allow “Other”"
              hint={
                question.type === "single_select"
                  ? "Adds a tile that opens a text field"
                  : undefined
              }
              checked={question.settings.allowOther}
              onCheckedChange={(allowOther) =>
                onChange({
                  ...question,
                  settings: { ...question.settings, allowOther },
                } as QuestionV1)
              }
            />
          )}
          {question.type === "multi_select" && (
            <>
              <PanelField label="Min selections" half>
                <Input
                  className={cn(PANEL_INPUT, bad)}
                  type="number"
                  min={0}
                  value={question.settings.minSelections ?? ""}
                  onChange={(e) =>
                    onChange({
                      ...question,
                      settings: {
                        ...question.settings,
                        minSelections: num(e.target.value),
                      },
                    })
                  }
                />
              </PanelField>
              <PanelField label="Max selections" half>
                <Input
                  className={cn(PANEL_INPUT, bad)}
                  type="number"
                  min={1}
                  value={question.settings.maxSelections ?? ""}
                  onChange={(e) =>
                    onChange({
                      ...question,
                      settings: {
                        ...question.settings,
                        maxSelections: num(e.target.value),
                      },
                    })
                  }
                />
              </PanelField>
            </>
          )}
          {question.type === "dropdown" && (
            <PanelNote>
              Tip: paste a list with one option per line to add many at once.
            </PanelNote>
          )}
        </>
      )}

      {question.type === "yes_no" && (
        <>
          <SectionHead>Labels</SectionHead>
          <PanelField label="Yes label" half>
            <Input
              className={PANEL_INPUT}
              value={question.settings.yesLabel ?? ""}
              placeholder="Yes"
              onChange={(e) =>
                onChange({
                  ...question,
                  settings: { ...question.settings, yesLabel: e.target.value },
                })
              }
            />
          </PanelField>
          <PanelField label="No label" half>
            <Input
              className={PANEL_INPUT}
              value={question.settings.noLabel ?? ""}
              placeholder="No"
              onChange={(e) =>
                onChange({
                  ...question,
                  settings: { ...question.settings, noLabel: e.target.value },
                })
              }
            />
          </PanelField>
        </>
      )}

      {question.type === "date" && (
        <>
          <SectionHead>Limits</SectionHead>
          <PanelField label="Earliest date" half>
            <Input
              className={PANEL_INPUT}
              type="date"
              value={question.settings.minDate ?? ""}
              onChange={(e) =>
                onChange({
                  ...question,
                  settings: {
                    ...question.settings,
                    minDate: e.target.value || undefined,
                  },
                })
              }
            />
          </PanelField>
          <PanelField label="Latest date" half>
            <Input
              className={PANEL_INPUT}
              type="date"
              value={question.settings.maxDate ?? ""}
              onChange={(e) =>
                onChange({
                  ...question,
                  settings: {
                    ...question.settings,
                    maxDate: e.target.value || undefined,
                  },
                })
              }
            />
          </PanelField>
        </>
      )}

      {question.type === "rating" && (
        <>
          <SectionHead>Scale</SectionHead>
          <Segmented
            label="Scale"
            value={String(question.settings.scale) as "5" | "10"}
            options={[
              { value: "5", label: "5" },
              { value: "10", label: "10" },
            ]}
            onChange={(value) =>
              onChange({
                ...question,
                settings: { ...question.settings, scale: Number(value) as 5 | 10 },
              })
            }
          />
        </>
      )}

      {question.type === "opinion_scale" && (
        <>
          <SectionHead>Scale</SectionHead>
          <PanelField label="Min" half>
            <Input
              className={cn(PANEL_INPUT, bad)}
              type="number"
              value={question.settings.min}
              onChange={(e) =>
                onChange({
                  ...question,
                  settings: { ...question.settings, min: Number(e.target.value) },
                })
              }
            />
          </PanelField>
          <PanelField label="Max" half>
            <Input
              className={cn(PANEL_INPUT, bad)}
              type="number"
              value={question.settings.max}
              onChange={(e) =>
                onChange({
                  ...question,
                  settings: { ...question.settings, max: Number(e.target.value) },
                })
              }
            />
          </PanelField>
          <PanelField label="Left label" half>
            <Input
              className={PANEL_INPUT}
              value={question.settings.leftLabel ?? ""}
              placeholder="Not likely"
              onChange={(e) =>
                onChange({
                  ...question,
                  settings: { ...question.settings, leftLabel: e.target.value },
                })
              }
            />
          </PanelField>
          <PanelField label="Right label" half>
            <Input
              className={PANEL_INPUT}
              value={question.settings.rightLabel ?? ""}
              placeholder="Very likely"
              onChange={(e) =>
                onChange({
                  ...question,
                  settings: { ...question.settings, rightLabel: e.target.value },
                })
              }
            />
          </PanelField>
        </>
      )}

      {question.type === "file_upload" && (
        <>
          <SectionHead>Files</SectionHead>
          <ChipToggles
            label="Accepted file types"
            options={FILE_KINDS.map((kind) => {
              const accepted = question.settings.acceptedMimeTypes;
              const on = accepted.includes(kind.mime);
              return {
                label: kind.label,
                on,
                onToggle: () => {
                  const next = on
                    ? accepted.filter((m) => m !== kind.mime)
                    : [...accepted, kind.mime];
                  // At least one type stays on — the schema needs one.
                  if (next.length === 0) return;
                  onChange({
                    ...question,
                    settings: { ...question.settings, acceptedMimeTypes: next },
                  });
                },
              };
            })}
          />
          <PanelField label="Max size" hint="In MB, up to 100.">
            <Input
              className={cn(PANEL_INPUT, bad)}
              type="number"
              min={1}
              max={100}
              value={question.settings.maxSizeMb}
              onChange={(e) =>
                onChange({
                  ...question,
                  settings: { ...question.settings, maxSizeMb: Number(e.target.value) },
                })
              }
            />
          </PanelField>
        </>
      )}
    </div>
  );
}

type ContactQuestion = Extract<QuestionV1, { type: "contact_info" }>;

/** Which contact fields to ask for, and which are required. At least
 * one field stays on; turning a field off also drops its "required". */
function ContactInfoSettings({
  question,
  onChange,
}: {
  question: ContactQuestion;
  onChange: (next: QuestionV1) => void;
}) {
  const { fields, requiredFields } = question.settings;

  function update(nextFields: ContactField[], nextRequired: ContactField[]) {
    // Keep the canonical field order regardless of click order.
    const ordered = CONTACT_FIELDS.filter((f) => nextFields.includes(f));
    const required = ordered.filter((f) => nextRequired.includes(f));
    onChange({
      ...question,
      required: required.length > 0,
      settings: { fields: ordered, requiredFields: required },
    });
  }

  return (
    <>
      <SectionHead>Lead details</SectionHead>
      <div className="col-span-full flex flex-col gap-2">
        <p className="text-muted-foreground text-[12.5px]">
          Saved as soon as the respondent moves on — you keep the lead even if they
          don&apos;t finish the form.
        </p>
        <div className="divide-border border-border bg-card divide-y overflow-hidden rounded-sm border-[1.5px]">
          {CONTACT_FIELDS.map((field) => {
            const shown = fields.includes(field);
            const isOnlyField = shown && fields.length === 1;
            return (
              <div
                key={field}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Checkbox
                    checked={shown}
                    disabled={isOnlyField}
                    onCheckedChange={(checked) =>
                      update(
                        checked ? [...fields, field] : fields.filter((f) => f !== field),
                        requiredFields.filter((f) => f !== field || checked),
                      )
                    }
                  />
                  {CONTACT_FIELD_LABELS[field]}
                </label>
                <label
                  // Dimmed because its switch is off-limits until the field is
                  // shown; aria-disabled tells tools that's deliberate.
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
