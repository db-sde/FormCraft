"use client";

import type { QuestionV1 } from "@/domains/forms/schema/v1";
import { OptionsEditor } from "./options-editor";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground text-xs font-medium">{label}</Label>
      {children}
    </div>
  );
}

/** Type-specific settings editor. `onChange` receives a fully-formed
 * replacement question (the caller owns persisting it) — kept as one
 * function rather than per-field setters so each branch can update
 * `settings` immutably without a generic/unsafe partial-merge helper
 * fighting the discriminated union. */
export function SettingsPanel({
  question,
  onChange,
}: {
  question: QuestionV1;
  onChange: (next: QuestionV1) => void;
}) {
  return (
    <div className="space-y-5">
      {question.type !== "welcome_screen" && question.type !== "statement" && (
        <>
          <div className="flex items-center justify-between">
            <Label htmlFor="required-toggle" className="text-sm font-medium">
              Required
            </Label>
            <Switch
              id="required-toggle"
              checked={question.required}
              onCheckedChange={(required) => onChange({ ...question, required })}
            />
          </div>
          <Separator />
        </>
      )}

      {question.type === "welcome_screen" && (
        <Field label="Button label">
          <Input
            value={question.settings.buttonLabel ?? ""}
            onChange={(e) =>
              onChange({
                ...question,
                settings: { ...question.settings, buttonLabel: e.target.value },
              })
            }
          />
        </Field>
      )}

      {question.type === "statement" && (
        <Field label="Button label">
          <Input
            value={question.settings.buttonLabel ?? ""}
            onChange={(e) =>
              onChange({
                ...question,
                settings: { ...question.settings, buttonLabel: e.target.value },
              })
            }
          />
        </Field>
      )}

      {question.type === "short_text" && (
        <>
          <Field label="Placeholder">
            <Input
              value={question.settings.placeholder ?? ""}
              onChange={(e) =>
                onChange({
                  ...question,
                  settings: { ...question.settings, placeholder: e.target.value },
                })
              }
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Min length">
              <Input
                type="number"
                min={0}
                value={question.settings.minLength ?? ""}
                onChange={(e) =>
                  onChange({
                    ...question,
                    settings: {
                      ...question.settings,
                      minLength:
                        e.target.value === "" ? undefined : Number(e.target.value),
                    },
                  })
                }
              />
            </Field>
            <Field label="Max length">
              <Input
                type="number"
                min={1}
                value={question.settings.maxLength ?? ""}
                onChange={(e) =>
                  onChange({
                    ...question,
                    settings: {
                      ...question.settings,
                      maxLength:
                        e.target.value === "" ? undefined : Number(e.target.value),
                    },
                  })
                }
              />
            </Field>
          </div>
        </>
      )}

      {question.type === "long_text" && (
        <>
          <Field label="Placeholder">
            <Input
              value={question.settings.placeholder ?? ""}
              onChange={(e) =>
                onChange({
                  ...question,
                  settings: { ...question.settings, placeholder: e.target.value },
                })
              }
            />
          </Field>
          <Field label="Max length">
            <Input
              type="number"
              min={1}
              value={question.settings.maxLength ?? ""}
              onChange={(e) =>
                onChange({
                  ...question,
                  settings: {
                    ...question.settings,
                    maxLength: e.target.value === "" ? undefined : Number(e.target.value),
                  },
                })
              }
            />
          </Field>
        </>
      )}

      {question.type === "phone" && (
        <Field label="Default country code">
          <Input
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
        </Field>
      )}

      {question.type === "number" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Min">
              <Input
                type="number"
                value={question.settings.min ?? ""}
                onChange={(e) =>
                  onChange({
                    ...question,
                    settings: {
                      ...question.settings,
                      min: e.target.value === "" ? undefined : Number(e.target.value),
                    },
                  })
                }
              />
            </Field>
            <Field label="Max">
              <Input
                type="number"
                value={question.settings.max ?? ""}
                onChange={(e) =>
                  onChange({
                    ...question,
                    settings: {
                      ...question.settings,
                      max: e.target.value === "" ? undefined : Number(e.target.value),
                    },
                  })
                }
              />
            </Field>
          </div>
          <Field label="Decimal places">
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
              <SelectTrigger className="w-full">
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
          </Field>
        </>
      )}

      {question.type === "single_select" && (
        <>
          <Field label="Options">
            <OptionsEditor
              options={question.settings.options}
              onChange={(options) =>
                onChange({ ...question, settings: { ...question.settings, options } })
              }
            />
          </Field>
          <div className="flex items-center justify-between">
            <Label htmlFor="allow-other" className="text-sm font-medium">
              Allow &quot;Other&quot;
            </Label>
            <Switch
              id="allow-other"
              checked={question.settings.allowOther}
              onCheckedChange={(allowOther) =>
                onChange({ ...question, settings: { ...question.settings, allowOther } })
              }
            />
          </div>
        </>
      )}

      {question.type === "multi_select" && (
        <>
          <Field label="Options">
            <OptionsEditor
              options={question.settings.options}
              onChange={(options) =>
                onChange({ ...question, settings: { ...question.settings, options } })
              }
            />
          </Field>
          <div className="flex items-center justify-between">
            <Label htmlFor="allow-other" className="text-sm font-medium">
              Allow &quot;Other&quot;
            </Label>
            <Switch
              id="allow-other"
              checked={question.settings.allowOther}
              onCheckedChange={(allowOther) =>
                onChange({ ...question, settings: { ...question.settings, allowOther } })
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Min selections">
              <Input
                type="number"
                min={0}
                value={question.settings.minSelections ?? ""}
                onChange={(e) =>
                  onChange({
                    ...question,
                    settings: {
                      ...question.settings,
                      minSelections:
                        e.target.value === "" ? undefined : Number(e.target.value),
                    },
                  })
                }
              />
            </Field>
            <Field label="Max selections">
              <Input
                type="number"
                min={1}
                value={question.settings.maxSelections ?? ""}
                onChange={(e) =>
                  onChange({
                    ...question,
                    settings: {
                      ...question.settings,
                      maxSelections:
                        e.target.value === "" ? undefined : Number(e.target.value),
                    },
                  })
                }
              />
            </Field>
          </div>
        </>
      )}

      {question.type === "dropdown" && (
        <Field label="Options">
          <OptionsEditor
            options={question.settings.options}
            onChange={(options) =>
              onChange({ ...question, settings: { ...question.settings, options } })
            }
          />
        </Field>
      )}

      {question.type === "yes_no" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Yes label">
            <Input
              value={question.settings.yesLabel ?? ""}
              placeholder="Yes"
              onChange={(e) =>
                onChange({
                  ...question,
                  settings: { ...question.settings, yesLabel: e.target.value },
                })
              }
            />
          </Field>
          <Field label="No label">
            <Input
              value={question.settings.noLabel ?? ""}
              placeholder="No"
              onChange={(e) =>
                onChange({
                  ...question,
                  settings: { ...question.settings, noLabel: e.target.value },
                })
              }
            />
          </Field>
        </div>
      )}

      {question.type === "date" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Earliest date">
            <Input
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
          </Field>
          <Field label="Latest date">
            <Input
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
          </Field>
        </div>
      )}

      {question.type === "rating" && (
        <Field label="Scale">
          <Select
            value={String(question.settings.scale)}
            onValueChange={(value) =>
              onChange({
                ...question,
                settings: { ...question.settings, scale: Number(value) as 5 | 10 },
              })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="5">1–5</SelectItem>
              <SelectItem value="10">1–10</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      )}

      {question.type === "opinion_scale" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Min">
              <Input
                type="number"
                value={question.settings.min}
                onChange={(e) =>
                  onChange({
                    ...question,
                    settings: { ...question.settings, min: Number(e.target.value) },
                  })
                }
              />
            </Field>
            <Field label="Max">
              <Input
                type="number"
                value={question.settings.max}
                onChange={(e) =>
                  onChange({
                    ...question,
                    settings: { ...question.settings, max: Number(e.target.value) },
                  })
                }
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Left label">
              <Input
                value={question.settings.leftLabel ?? ""}
                onChange={(e) =>
                  onChange({
                    ...question,
                    settings: { ...question.settings, leftLabel: e.target.value },
                  })
                }
              />
            </Field>
            <Field label="Right label">
              <Input
                value={question.settings.rightLabel ?? ""}
                onChange={(e) =>
                  onChange({
                    ...question,
                    settings: { ...question.settings, rightLabel: e.target.value },
                  })
                }
              />
            </Field>
          </div>
        </>
      )}

      {question.type === "file_upload" && (
        <>
          <Field label="Accepted types (comma-separated)">
            <Input
              value={question.settings.acceptedMimeTypes.join(", ")}
              onChange={(e) =>
                onChange({
                  ...question,
                  settings: {
                    ...question.settings,
                    acceptedMimeTypes: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                })
              }
            />
          </Field>
          <Field label="Max size (MB)">
            <Input
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
          </Field>
        </>
      )}

      {(question.type === "email" || question.type === "url") && (
        <p className="text-muted-foreground text-xs">
          Answers are validated automatically as{" "}
          {question.type === "email" ? "an email address" : "a URL"}.
        </p>
      )}
    </div>
  );
}
