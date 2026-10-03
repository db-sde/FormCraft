"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  deleteLookupAction,
  saveLookupAction,
} from "@/app/(form)/forms/[id]/(sections)/integrations/actions";
import type { LookupSummary } from "@/domains/integrations/lookups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/toast";

type Question = { id: string; number: number; label: string };
type Output = { field: string; path: string };

const SELECT = "border-input bg-background h-9 rounded-md border px-2 text-sm";

/**
 * Data lookups (logic spec phase 24): after a question, call your own
 * API and put fields from its JSON reply into the form's URL fields —
 * which rules, formulas and {{recall}} can then use.
 */
export function LookupsPanel({
  formId,
  allowed,
  lookups,
  questions,
  fields,
}: {
  formId: string;
  allowed: boolean;
  lookups: LookupSummary[];
  questions: Question[];
  /** URL fields the draft declares (Logic → Variables). */
  fields: string[];
}) {
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState(questions[0]?.id ?? "");
  const [url, setUrl] = useState("");
  const [headerName, setHeaderName] = useState("");
  const [headerValue, setHeaderValue] = useState("");
  const [outputs, setOutputs] = useState<Output[]>([
    { field: fields[0] ?? "", path: "" },
  ]);

  if (!allowed) {
    return (
      <p className="text-muted-foreground text-sm">
        Data lookups are included in the Business plan.
      </p>
    );
  }

  const label = (id: string) => {
    const q = questions.find((x) => x.id === id);
    return q ? `${q.number} · ${q.label}` : "a question that no longer exists";
  };

  return (
    <div className="flex flex-col gap-3 text-sm">
      {lookups.length > 0 && (
        <ul className="border-ink bg-card overflow-hidden rounded-lg border-[1.5px]">
          {lookups.map((lookup) => (
            <li
              key={lookup.id}
              className="border-border flex flex-wrap items-start gap-3 border-b px-3.5 py-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <b>{lookup.name}</b>
                <p className="text-muted-foreground text-[12.5px] break-all">
                  After {label(lookup.triggerQuestionId)} · GET {lookup.url}
                  {lookup.headerName ? ` · sends ${lookup.headerName}` : ""}
                </p>
                <p className="text-[12.5px]">
                  Fills{" "}
                  {lookup.outputs.map((o, i) => (
                    <span key={o.field}>
                      {i > 0 && ", "}
                      <code>{o.field}</code> from <code>{o.path}</code>
                    </span>
                  ))}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${lookup.name}`}
                disabled={pending}
                onClick={() => {
                  if (!window.confirm(`Delete the lookup “${lookup.name}”?`)) return;
                  start(async () => {
                    const result = await deleteLookupAction(formId, lookup.id);
                    if (!result.ok) toast.error(result.message);
                  });
                }}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {fields.length === 0 ? (
        <p className="text-muted-foreground">
          A lookup fills URL fields. Add one first in the builder: Logic → Variables → URL
          fields, then publish.
        </p>
      ) : !adding ? (
        <div>
          <Button variant="outline" onClick={() => setAdding(true)}>
            <Plus /> Add a lookup
          </Button>
        </div>
      ) : (
        <form
          className="border-ink bg-card flex flex-col gap-3 rounded-lg border-[1.5px] p-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const result = await saveLookupAction(formId, {
                name,
                triggerQuestionId: trigger,
                url,
                headerName: headerName.trim() || null,
                headerValue: headerName.trim() ? headerValue : null,
                outputs: outputs.filter((o) => o.field && o.path.trim()),
              });
              if (!result.ok) return void toast.error(result.message);
              toast.success("Lookup added.");
              setAdding(false);
              setName("");
              setUrl("");
              setHeaderName("");
              setHeaderValue("");
              setOutputs([{ field: fields[0] ?? "", path: "" }]);
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lookup-name">Name</Label>
              <Input
                id="lookup-name"
                value={name}
                maxLength={80}
                placeholder="Company size"
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lookup-trigger">Run after</Label>
              <select
                id="lookup-trigger"
                value={trigger}
                onChange={(e) => setTrigger(e.target.value)}
                className={SELECT}
              >
                {questions.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.number} · {q.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lookup-url">URL (GET, returns JSON)</Label>
            <Input
              id="lookup-url"
              value={url}
              maxLength={2000}
              placeholder={`https://api.example.com/companies?email={{answer:${trigger || "question"}}}`}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
            <p className="text-muted-foreground text-[12.5px]">
              Put an answer in the path or query with{" "}
              <code>
                {"{{answer:"}
                {trigger || "question id"}
                {"}}"}
              </code>
              . HTTPS and a public address only.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lookup-header">Header (optional)</Label>
              <Input
                id="lookup-header"
                value={headerName}
                maxLength={64}
                placeholder="Authorization"
                onChange={(e) => setHeaderName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lookup-header-value">Header value</Label>
              <Input
                id="lookup-header-value"
                type="password"
                autoComplete="off"
                value={headerValue}
                maxLength={2000}
                placeholder="Bearer …"
                disabled={!headerName.trim()}
                onChange={(e) => setHeaderValue(e.target.value)}
              />
            </div>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[13px] font-semibold">
              What to keep from the reply
            </legend>
            {outputs.map((output, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select
                  aria-label={`URL field ${i + 1}`}
                  value={output.field}
                  onChange={(e) =>
                    setOutputs(
                      outputs.map((o, n) =>
                        n === i ? { ...o, field: e.target.value } : o,
                      ),
                    )
                  }
                  className={SELECT}
                >
                  {fields.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <span className="text-muted-foreground">from</span>
                <Input
                  aria-label={`Path in the reply ${i + 1}`}
                  value={output.path}
                  maxLength={200}
                  placeholder="company.employees"
                  onChange={(e) =>
                    setOutputs(
                      outputs.map((o, n) =>
                        n === i ? { ...o, path: e.target.value } : o,
                      ),
                    )
                  }
                  className="max-w-56"
                />
                {outputs.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove field ${i + 1}`}
                    onClick={() => setOutputs(outputs.filter((_, n) => n !== i))}
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            ))}
            {outputs.length < Math.min(10, fields.length) && (
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setOutputs([
                      ...outputs,
                      {
                        field:
                          fields.find((f) => !outputs.some((o) => o.field === f)) ?? "",
                        path: "",
                      },
                    ])
                  }
                >
                  <Plus /> Another field
                </Button>
              </div>
            )}
          </fieldset>
          <p className="text-muted-foreground text-[12.5px]">
            The values are used by your form&apos;s logic in the respondent&apos;s
            browser, so only fetch what a respondent may see. The header value is stored
            encrypted and never sent to browsers. If your API is slow or down, the form
            carries on without the values.
          </p>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              Add lookup
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
