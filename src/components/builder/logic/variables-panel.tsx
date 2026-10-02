"use client";

import { useState } from "react";
import { Braces, Link2, Plus } from "lucide-react";
import { nanoid } from "nanoid";
import {
  VARIABLE_TYPES,
  variableName,
  type HiddenFieldV1,
  type Value,
  type VariableType,
  type VariableV1,
} from "@/domains/forms/schema/logic-model";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/lib/toast";
import { RemoveButton } from "./operand";

const TYPE_LABEL: Record<VariableType, string> = {
  number: "Number",
  string: "Text",
  boolean: "Yes / No",
  date: "Date",
  list: "List",
};

/** Whether anything in the form still refers to this id or name. */
function usedIn(
  schema: FormSchemaV1,
  needle: string,
  kind: "variable" | "hidden",
): boolean {
  const json = JSON.stringify({
    ...schema,
    variables: undefined,
    hiddenFields: undefined,
  });
  return kind === "variable"
    ? json.includes(`"variableId":"${needle}"`) ||
        (schema.variables ?? []).some(
          (v) => v.id === needle && json.includes(`{{${v.name}}}`),
        )
    : json.includes(`"type":"hidden","name":"${needle}"`) ||
        json.includes(`{{${needle}}}`);
}

function suggestName(existing: string[], base: string) {
  let name = base;
  for (let i = 2; existing.includes(name); i += 1) name = `${base}_${i}`;
  return name;
}

function NameInput({
  value,
  onCommit,
  label,
}: {
  value: string;
  onCommit: (name: string) => boolean;
  label: string;
}) {
  const [draft, setDraft] = useState(value);
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setDraft(value);
  }
  const valid = variableName.safeParse(draft).success;
  return (
    <Input
      aria-label={label}
      aria-invalid={!valid}
      value={draft}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value.toLowerCase().replace(/\s+/g, "_"))}
      onBlur={() => {
        if (!valid || !onCommit(draft)) setDraft(value);
      }}
      className="h-[34px] w-40 px-2.5 font-mono text-[13px]"
    />
  );
}

function InitialInput({
  variable,
  onChange,
}: {
  variable: VariableV1;
  onChange: (initial: Value | undefined) => void;
}) {
  const v = variable.initial;
  if (variable.type === "boolean") {
    return (
      <Select
        value={v === true ? "yes" : "no"}
        onValueChange={(x) => onChange(x === "yes")}
      >
        <SelectTrigger
          size="sm"
          className="h-[34px] w-28 text-[13.5px]"
          aria-label={`${variable.name} starts as`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value="no">No</SelectItem>
          <SelectItem value="yes">Yes</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  if (variable.type === "list") {
    return <span className="text-muted-foreground w-28 text-[13px]">Starts empty</span>;
  }
  return (
    <Input
      aria-label={`${variable.name} starts as`}
      type={
        variable.type === "number" ? "number" : variable.type === "date" ? "date" : "text"
      }
      value={v === undefined || v === null ? "" : String(v)}
      placeholder={variable.type === "number" ? "0" : "empty"}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") onChange(undefined);
        else onChange(variable.type === "number" ? Number(raw) : raw);
      }}
      className="h-[34px] w-28 px-2.5 text-sm"
    />
  );
}

export function VariablesPanel({
  schema,
  onChange,
}: {
  schema: FormSchemaV1;
  onChange: (patch: Partial<FormSchemaV1>) => void;
}) {
  const variables = schema.variables ?? [];
  const hidden = schema.hiddenFields ?? [];
  const names = [...variables.map((v) => v.name), ...hidden.map((h) => h.name)];

  const setVariables = (next: VariableV1[]) => onChange({ variables: next });
  const setHidden = (next: HiddenFieldV1[]) => onChange({ hiddenFields: next });
  const rename = (current: string, next: string) => {
    if (next === current) return true;
    if (names.includes(next)) {
      toast.error("That name is taken.", { description: "Names must be unique." });
      return false;
    }
    return true;
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="border-ink bg-card flex flex-col gap-3 rounded-lg border-[1.5px] p-4">
        <div className="flex items-start gap-2.5">
          <Braces className="mt-0.5 size-4 shrink-0" />
          <div className="flex-1">
            <h2 className="font-heading text-[17px] font-bold">Variables</h2>
            <p className="text-muted-foreground text-[13.5px] leading-normal">
              Scores, totals, segments — anything your rules calculate. Show one to
              respondents by writing <span className="font-mono">{"{{name}}"}</span> in a
              question, button or ending.
            </p>
          </div>
        </div>
        {variables.length === 0 && (
          <p className="text-muted-foreground text-[13.5px]">No variables yet.</p>
        )}
        {variables.map((variable, i) => (
          <div key={variable.id} className="flex flex-wrap items-center gap-1.5">
            <NameInput
              value={variable.name}
              label={`Variable ${i + 1} name`}
              onCommit={(name) => {
                if (!rename(variable.name, name)) return false;
                if (name !== variable.name && usedIn(schema, variable.id, "variable")) {
                  // Recall tokens use the name; rules use the id and are unaffected.
                  toast("Renamed.", {
                    description: `Update any {{${variable.name}}} you wrote in questions or endings.`,
                  });
                }
                setVariables(
                  variables.map((v) => (v.id === variable.id ? { ...v, name } : v)),
                );
                return true;
              }}
            />
            <Select
              value={variable.type}
              onValueChange={(type) => {
                if (usedIn(schema, variable.id, "variable")) {
                  toast.error("Can't change its type while rules use it.");
                  return;
                }
                setVariables(
                  variables.map((v) =>
                    v.id === variable.id
                      ? { ...v, type: type as VariableType, initial: undefined }
                      : v,
                  ),
                );
              }}
            >
              <SelectTrigger
                size="sm"
                className="h-[34px] w-28 text-[13.5px]"
                aria-label={`${variable.name} type`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {VARIABLE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground text-[13px]">starts as</span>
            <InitialInput
              variable={variable}
              onChange={(initial) =>
                setVariables(
                  variables.map((v) => (v.id === variable.id ? { ...v, initial } : v)),
                )
              }
            />
            <RemoveButton
              label={`Delete ${variable.name}`}
              onClick={() => {
                if (usedIn(schema, variable.id, "variable")) {
                  toast.error(`“${variable.name}” is still used.`, {
                    description: "Remove it from your rules, scores and text first.",
                  });
                  return;
                }
                setVariables(variables.filter((v) => v.id !== variable.id));
              }}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setVariables([
              ...variables,
              {
                id: `var_${nanoid(8)}`,
                name: suggestName(names, variables.length ? "variable" : "score"),
                type: "number",
              },
            ])
          }
          className="fc-focus border-ink hover:bg-hover-wash flex h-8 items-center gap-1.5 self-start rounded-sm border-[1.5px] border-dashed px-2.5 text-[13px] font-semibold"
        >
          <Plus className="size-[13px]" /> Add variable
        </button>
      </section>

      <section className="border-ink bg-card flex flex-col gap-3 rounded-lg border-[1.5px] p-4">
        <div className="flex items-start gap-2.5">
          <Link2 className="mt-0.5 size-4 shrink-0" />
          <div className="flex-1">
            <h2 className="font-heading text-[17px] font-bold">URL fields</h2>
            <p className="text-muted-foreground text-[13.5px] leading-normal">
              Values your link carries, like{" "}
              <span className="font-mono">?source=linkedin</span>. Use them in rules and{" "}
              <span className="font-mono">{"{{name}}"}</span> text. Anyone can edit a
              link, so never use them to decide access or prices you rely on.
            </p>
          </div>
        </div>
        {hidden.map((field, i) => (
          <div key={field.name} className="flex flex-wrap items-center gap-1.5">
            <NameInput
              value={field.name}
              label={`URL field ${i + 1} name`}
              onCommit={(name) => {
                if (!rename(field.name, name)) return false;
                if (name !== field.name && usedIn(schema, field.name, "hidden")) {
                  toast.error("Can't rename it while it's used.");
                  return false;
                }
                setHidden(
                  hidden.map((h) => (h.name === field.name ? { ...h, name } : h)),
                );
                return true;
              }}
            />
            <span className="text-muted-foreground text-[13px]">if missing</span>
            <Input
              aria-label={`${field.name} default`}
              value={field.default ?? ""}
              placeholder="empty"
              onChange={(e) =>
                setHidden(
                  hidden.map((h) =>
                    h.name === field.name
                      ? { ...h, default: e.target.value || undefined }
                      : h,
                  ),
                )
              }
              className="h-[34px] w-36 px-2.5 text-sm"
            />
            <RemoveButton
              label={`Delete ${field.name}`}
              onClick={() => {
                if (usedIn(schema, field.name, "hidden")) {
                  toast.error(`“${field.name}” is still used.`, {
                    description: "Remove it from your rules and text first.",
                  });
                  return;
                }
                setHidden(hidden.filter((h) => h.name !== field.name));
              }}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setHidden([
              ...hidden,
              { name: suggestName(names, hidden.length ? "field" : "source") },
            ])
          }
          className="fc-focus border-ink hover:bg-hover-wash flex h-8 items-center gap-1.5 self-start rounded-sm border-[1.5px] border-dashed px-2.5 text-[13px] font-semibold"
        >
          <Plus className="size-[13px]" /> Add URL field
        </button>
      </section>
    </div>
  );
}
