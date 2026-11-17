"use client";

import { nanoid } from "nanoid";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import {
  GROUP_FIELD_TYPES,
  type GroupFieldV1,
  type QuestionV1,
} from "@/domains/forms/schema/v1";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PANEL_INPUT, PanelField, PanelNote, SectionHead } from "./panel-ui";
import { QUESTION_TYPE_META } from "./question-meta";

type RepeatGroupQuestion = Extract<QuestionV1, { type: "repeat_group" }>;

const OPS: { value: NonNullable<GroupFieldV1["showIf"]>["op"]; label: string }[] = [
  { value: "equals", label: "is" },
  { value: "not_equals", label: "isn't" },
  { value: "is_filled", label: "is answered" },
  { value: "is_empty", label: "isn't answered" },
];

function count(raw: string, min: number, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= 50 ? n : fallback;
}

/** A group's fields and limits (F-56). Field ids are stable: renaming or
 * moving a field keeps every answer already given to it. */
export function RepeatGroupSettingsPanel({
  question,
  onChange,
}: {
  question: RepeatGroupQuestion;
  onChange: (question: RepeatGroupQuestion) => void;
}) {
  const s = question.settings;
  const set = (patch: Partial<RepeatGroupQuestion["settings"]>) =>
    onChange({ ...question, settings: { ...s, ...patch } });
  const setFields = (fields: GroupFieldV1[]) => set({ fields });
  const setField = (id: string, patch: Partial<GroupFieldV1>) =>
    setFields(
      s.fields.map((f) => (f.id === id ? ({ ...f, ...patch } as GroupFieldV1) : f)),
    );

  function remove(id: string) {
    // A field others depend on takes those conditions with it.
    setFields(
      s.fields
        .filter((f) => f.id !== id)
        .map((f) => (f.showIf?.fieldId === id ? { ...f, showIf: undefined } : f)),
    );
  }
  function move(index: number, by: -1 | 1) {
    const next = [...s.fields];
    const [field] = next.splice(index, 1);
    next.splice(index + by, 0, field);
    // A condition may only look at a field above it.
    setFields(
      next.map((f, i) =>
        f.showIf && !next.slice(0, i).some((g) => g.id === f.showIf!.fieldId)
          ? { ...f, showIf: undefined }
          : f,
      ),
    );
  }

  return (
    <>
      <SectionHead>Entries</SectionHead>
      <PanelField label="One entry is a" half hint="Shown as “Guest 1”, “Guest 2”…">
        <Input
          className={PANEL_INPUT}
          value={s.entryLabel ?? ""}
          placeholder="Entry"
          maxLength={60}
          onChange={(e) => set({ entryLabel: e.target.value || undefined })}
        />
      </PanelField>
      <PanelField label="Add button" half>
        <Input
          className={PANEL_INPUT}
          value={s.addLabel ?? ""}
          placeholder={`Add another ${(s.entryLabel || "entry").toLowerCase()}`}
          maxLength={60}
          onChange={(e) => set({ addLabel: e.target.value || undefined })}
        />
      </PanelField>
      <PanelField label="Fewest" half>
        <Input
          className={PANEL_INPUT}
          type="number"
          min={0}
          max={s.maxEntries}
          value={s.minEntries}
          onChange={(e) =>
            set({
              minEntries: Math.min(count(e.target.value, 0, s.minEntries), s.maxEntries),
            })
          }
        />
      </PanelField>
      <PanelField label="Most" half>
        <Input
          className={PANEL_INPUT}
          type="number"
          min={Math.max(1, s.minEntries)}
          max={50}
          value={s.maxEntries}
          onChange={(e) =>
            set({
              maxEntries: Math.max(count(e.target.value, 1, s.maxEntries), s.minEntries),
            })
          }
        />
      </PanelField>

      <SectionHead>Fields in each entry</SectionHead>
      <ol className="col-span-full flex flex-col gap-3" aria-label="Group fields">
        {s.fields.map((field, index) => {
          const earlier = s.fields.slice(0, index);
          const source = earlier.find((f) => f.id === field.showIf?.fieldId);
          return (
            <li
              key={field.id}
              className="border-ink/20 flex flex-col gap-2.5 rounded-lg border-[1.5px] bg-white p-3"
            >
              <div className="flex items-center gap-1.5">
                <Input
                  className={PANEL_INPUT}
                  aria-label={`Field ${index + 1} label`}
                  value={field.label}
                  maxLength={300}
                  onChange={(e) => setField(field.id, { label: e.target.value })}
                />
                <button
                  type="button"
                  aria-label={`Move “${field.label}” up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  className="grid size-8 shrink-0 place-items-center rounded-md hover:bg-black/5 disabled:opacity-30"
                >
                  <ArrowUp className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Move “${field.label}” down`}
                  disabled={index === s.fields.length - 1}
                  onClick={() => move(index, 1)}
                  className="grid size-8 shrink-0 place-items-center rounded-md hover:bg-black/5 disabled:opacity-30"
                >
                  <ArrowDown className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Delete “${field.label}”`}
                  disabled={s.fields.length === 1}
                  onClick={() => remove(field.id)}
                  className="grid size-8 shrink-0 place-items-center rounded-md hover:bg-black/5 disabled:opacity-30"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              <div className="flex items-center gap-3">
                <Select
                  value={field.type}
                  onValueChange={(type) =>
                    setField(field.id, {
                      type: type as GroupFieldV1["type"],
                      options:
                        type === "dropdown"
                          ? (field.options ?? [
                              { id: `opt_${nanoid(8)}`, label: "Option 1" },
                              { id: `opt_${nanoid(8)}`, label: "Option 2" },
                            ])
                          : undefined,
                    })
                  }
                >
                  <SelectTrigger
                    className="h-[34px] flex-1"
                    aria-label={`Field ${index + 1} type`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GROUP_FIELD_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {QUESTION_TYPE_META[type].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-2 text-[13px] font-semibold">
                  <Switch
                    checked={field.required}
                    onCheckedChange={(required) => setField(field.id, { required })}
                    aria-label={`“${field.label}” is required`}
                  />
                  Required
                </label>
              </div>
              {field.type === "dropdown" && (
                <Textarea
                  rows={3}
                  className="min-h-0 text-sm"
                  aria-label={`“${field.label}” choices, one per line`}
                  defaultValue={(field.options ?? []).map((o) => o.label).join("\n")}
                  onBlur={(e) => {
                    const labels = e.target.value
                      .split("\n")
                      .map((l) => l.trim())
                      .filter(Boolean)
                      .slice(0, 50);
                    if (labels.length === 0) return;
                    // Keep the ids of choices whose words didn't change.
                    const old = field.options ?? [];
                    setField(field.id, {
                      options: labels.map(
                        (label, i) =>
                          old.find((o) => o.label === label) ??
                          (old[i] && !labels.includes(old[i].label)
                            ? { ...old[i], label }
                            : { id: `opt_${nanoid(8)}`, label }),
                      ),
                    });
                  }}
                />
              )}
              {earlier.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
                  <span className="text-muted-foreground">Show</span>
                  <Select
                    value={field.showIf ? field.showIf.fieldId : "always"}
                    onValueChange={(v) =>
                      setField(field.id, {
                        showIf:
                          v === "always"
                            ? undefined
                            : { fieldId: v, op: field.showIf?.op ?? "is_filled" },
                      })
                    }
                  >
                    <SelectTrigger
                      className="h-[30px] w-auto min-w-28"
                      aria-label={`When “${field.label}” shows`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="always">always</SelectItem>
                      {earlier.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          when “{f.label}”
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {field.showIf && source && (
                    <>
                      <Select
                        value={field.showIf.op}
                        onValueChange={(op) =>
                          setField(field.id, {
                            showIf: {
                              ...field.showIf!,
                              op: op as NonNullable<GroupFieldV1["showIf"]>["op"],
                              value:
                                op === "equals" || op === "not_equals"
                                  ? (field.showIf!.value ??
                                    (source.type === "yes_no"
                                      ? true
                                      : source.type === "dropdown"
                                        ? source.options?.[0]?.id
                                        : ""))
                                  : undefined,
                            },
                          })
                        }
                      >
                        <SelectTrigger className="h-[30px] w-auto" aria-label="Condition">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {OPS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {(field.showIf.op === "equals" ||
                        field.showIf.op === "not_equals") &&
                        (source.type === "yes_no" || source.type === "dropdown" ? (
                          <Select
                            value={String(field.showIf.value ?? "")}
                            onValueChange={(v) =>
                              setField(field.id, {
                                showIf: {
                                  ...field.showIf!,
                                  value: source.type === "yes_no" ? v === "true" : v,
                                },
                              })
                            }
                          >
                            <SelectTrigger className="h-[30px] w-auto" aria-label="Value">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {source.type === "yes_no"
                                ? [
                                    <SelectItem key="t" value="true">
                                      Yes
                                    </SelectItem>,
                                    <SelectItem key="f" value="false">
                                      No
                                    </SelectItem>,
                                  ]
                                : (source.options ?? []).map((o) => (
                                    <SelectItem key={o.id} value={o.id}>
                                      {o.label}
                                    </SelectItem>
                                  ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            className="h-[30px] w-32 text-[13px]"
                            aria-label="Value"
                            value={String(field.showIf.value ?? "")}
                            onChange={(e) =>
                              setField(field.id, {
                                showIf: {
                                  ...field.showIf!,
                                  value:
                                    source.type === "number" && e.target.value !== ""
                                      ? Number(e.target.value)
                                      : e.target.value,
                                },
                              })
                            }
                          />
                        ))}
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {s.fields.length < 10 && (
        <button
          type="button"
          onClick={() =>
            setFields([
              ...s.fields,
              {
                id: `f_${nanoid(10)}`,
                type: "short_text",
                label: `Field ${s.fields.length + 1}`,
                required: false,
              },
            ])
          }
          className="border-ink/30 col-span-full flex h-9 items-center justify-center gap-1.5 rounded-md border-[1.5px] border-dashed text-sm font-semibold"
        >
          <Plus className="size-4" />
          Add field
        </button>
      )}
      <PanelNote>
        Up to 10 fields. Files and signatures can&apos;t go in a group. Exports put each
        field in its own column, one line per entry.
      </PanelNote>
    </>
  );
}
