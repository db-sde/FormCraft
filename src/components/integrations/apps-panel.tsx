"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { CircleAlert, CircleCheck, Plus, X } from "lucide-react";
import {
  connectorChoicesAction,
  connectorFieldsAction,
  deleteConnectorLinkAction,
  disconnectAppAction,
  saveConnectorLinkAction,
} from "@/app/(form)/forms/[id]/(sections)/integrations/connector-actions";
import {
  APPS,
  fieldMatches,
  type AppInfo,
  type Choice,
  type FieldInfo,
  type SettingSpec,
} from "@/domains/connectors/catalog";
import type { MappingRow } from "@/domains/connectors/mapping";
import type { Condition } from "@/domains/forms/schema/logic-model";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { ConditionEditor } from "@/components/builder/logic/condition-editor";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/lib/toast";

export type AppLinkState = {
  enabled: boolean;
  settings: Record<string, unknown>;
  mapping: MappingRow[];
  condition: Condition | null;
};

export type AppState = {
  provider: AppInfo["provider"];
  connection: { label: string | null; status: "ok" | "invalid" } | null;
  link: AppLinkState | null;
};

type Option = { value: string; label: string };
type QuestionOption = { id: string; label: string; type: string };

const NONE = "__none";
const FIXED = "__fixed";

function defaults(app: AppInfo): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of app.settings) {
    if (s.kind === "static") out[s.key] = s.options[0]?.id;
    if (s.kind === "switch") out[s.key] = s.key === "doubleOptIn";
    if (s.kind === "tags") out[s.key] = [];
  }
  return out;
}

function Picker({
  label,
  value,
  options,
  onChange,
  optional,
  placeholder = "Choose…",
}: {
  label: string;
  value: string | undefined;
  options: Choice[];
  onChange: (value: string | undefined) => void;
  optional?: boolean;
  placeholder?: string;
}) {
  return (
    <Select
      value={value ?? (optional ? NONE : "")}
      onValueChange={(v) => onChange(v === NONE ? undefined : v)}
    >
      <SelectTrigger className="w-full" aria-label={label}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {optional && <SelectItem value={NONE}>None</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Options loaded from the app (bases, tables…), reloaded when the
 * setting they depend on changes. */
function RemoteChoice({
  formId,
  provider,
  spec,
  parent,
  value,
  onChange,
}: {
  formId: string;
  provider: string;
  spec: Extract<SettingSpec, { kind: "choice" }>;
  parent: string | undefined;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  // Results are kept with the parent they were loaded for, so a new
  // parent shows "Loading…" rather than the old list.
  const [loaded, setLoaded] = useState<{
    key: string;
    result: Awaited<ReturnType<typeof connectorChoicesAction>>;
  } | null>(null);
  const waiting = Boolean(spec.parent && !parent);
  const key = `${spec.source}|${parent ?? ""}`;
  useEffect(() => {
    if (waiting) return;
    let live = true;
    connectorChoicesAction(formId, provider, spec.source, parent).then((result) => {
      if (live) setLoaded({ key, result });
    });
    return () => {
      live = false;
    };
  }, [formId, provider, spec.source, parent, waiting, key]);
  const state =
    loaded?.key !== key
      ? ({ status: "loading" } as const)
      : loaded.result.ok
        ? ({ status: "ready", choices: loaded.result.choices } as const)
        : ({ status: "error", message: loaded.result.message } as const);
  if (waiting)
    return <p className="text-muted-foreground text-sm">Choose the one above first.</p>;
  if (state.status === "loading")
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (state.status === "error")
    return <p className="text-destructive text-sm">{state.message}</p>;
  if (!state.choices.length) {
    return (
      <p className="text-muted-foreground text-sm">
        Nothing found. Check it&apos;s shared with FormCraft in the app.
      </p>
    );
  }
  return (
    <Picker
      label={spec.label}
      value={value}
      options={state.choices}
      onChange={onChange}
    />
  );
}

function MappingEditor({
  fields,
  sources,
  rows,
  onChange,
  reserved,
}: {
  fields: FieldInfo[];
  sources: Option[];
  rows: MappingRow[];
  onChange: (rows: MappingRow[]) => void;
  /** Fields filled automatically (the response ID field). */
  reserved: string[];
}) {
  const writable = fields.filter((f) => f.supported && !reserved.includes(f.key));
  const used = new Set(rows.map((r) => r.field));
  const next = writable.find((f) => !used.has(f.key));
  const set = (i: number, patch: Partial<MappingRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, i) => {
        const fixed = row.source.startsWith("text:");
        return (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Picker
              label={`Field ${i + 1}`}
              value={row.field}
              options={writable
                .filter((f) => f.key === row.field || !used.has(f.key))
                .map((f) => ({ id: f.key, name: `${f.label}${f.required ? " *" : ""}` }))}
              onChange={(field) => field && set(i, { field })}
            />
            <div className="flex flex-col gap-1.5">
              <Select
                value={fixed ? FIXED : row.source}
                onValueChange={(v) => set(i, { source: v === FIXED ? "text:" : v })}
              >
                <SelectTrigger className="w-full" aria-label={`Value for field ${i + 1}`}>
                  <SelectValue placeholder="From…" />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                  <SelectItem value={FIXED}>Fixed text…</SelectItem>
                </SelectContent>
              </Select>
              {fixed && (
                <Input
                  aria-label={`Fixed text for field ${i + 1}`}
                  maxLength={300}
                  value={row.source.slice(5)}
                  onChange={(e) => set(i, { source: `text:${e.target.value}` })}
                />
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove field ${i + 1}`}
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
            >
              <X />
            </Button>
          </div>
        );
      })}
      {next && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() =>
            onChange([
              ...rows,
              { field: next.key, source: sources[0]?.value ?? "meta:response_id" },
            ])
          }
        >
          <Plus /> Add a field
        </Button>
      )}
    </div>
  );
}

function LinkEditor({
  formId,
  app,
  initial,
  schema,
  sources,
  questions,
  onDone,
}: {
  formId: string;
  app: AppInfo;
  initial: AppLinkState | null;
  schema: FormSchemaV1 | null;
  sources: Option[];
  questions: QuestionOption[];
  onDone: (saved: AppLinkState | null | "removed") => void;
}) {
  const [settings, setSettings] = useState<Record<string, unknown>>(
    initial?.settings ?? defaults(app),
  );
  const [mapping, setMapping] = useState<MappingRow[]>(initial?.mapping ?? []);
  const [condition, setCondition] = useState<Condition | undefined>(
    initial?.condition ?? undefined,
  );
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [loadedFields, setLoadedFields] = useState<{
    key: string;
    result: Awaited<ReturnType<typeof connectorFieldsAction>>;
  } | null>(null);
  const [pending, start] = useTransition();
  const str = (key: string) =>
    typeof settings[key] === "string" ? (settings[key] as string) : undefined;
  const set = (key: string, value: unknown) =>
    setSettings((s) => {
      const out = { ...s, [key]: value };
      // A new base or database: what depended on the old one goes.
      for (const spec of app.settings) {
        if (spec.kind === "choice" && spec.parent === key) delete out[spec.key];
      }
      return out;
    });

  const needKey = app.fieldsNeed.map((k) => str(k) ?? "").join("|");
  const ready = app.fieldsNeed.every((k) => str(k));
  useEffect(() => {
    if (!ready) return;
    let live = true;
    connectorFieldsAction(
      formId,
      app.provider,
      Object.fromEntries(app.fieldsNeed.map((k) => [k, settings[k]])),
    ).then((result) => {
      if (live) setLoadedFields({ key: needKey, result });
    });
    return () => {
      live = false;
    };
    // Only the settings the field list depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId, app.provider, needKey, ready]);
  const fields = !ready
    ? ({ status: "idle" } as const)
    : loadedFields?.key !== needKey
      ? ({ status: "loading" } as const)
      : loadedFields.result.ok
        ? ({ status: "ready", fields: loadedFields.result.fields } as const)
        : ({ status: "error", message: loadedFields.result.message } as const);

  const fieldList = fields.status === "ready" ? fields.fields : [];
  const reserved = app.settings
    .filter((s) => s.kind === "field" && s.key !== "externalIdField")
    .map((s) => str(s.key))
    .filter((v): v is string => Boolean(v));
  const mapped = new Set(mapping.map((r) => r.field));
  const missing = fieldList.filter(
    (f) => f.required && f.supported && !mapped.has(f.key) && !reserved.includes(f.key),
  );
  const unsupported = fieldList.filter((f) => !f.supported);
  const id = `app-${app.provider}`;

  return (
    <form
      className="bg-background flex flex-col gap-3.5 rounded-sm p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const link = { enabled, settings, mapping, condition: condition ?? null };
          const result = await saveConnectorLinkAction(formId, app.provider, link);
          if (result.ok) {
            toast.success("Saved.");
            onDone(link);
          } else toast.error(result.message);
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {app.settings.map((spec) => (
          <div key={spec.key} className="flex flex-col gap-1.5">
            {spec.kind === "switch" ? (
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={settings[spec.key] === true}
                  onCheckedChange={(v) => set(spec.key, v)}
                  aria-label={spec.label}
                />
                <span className="font-semibold">{spec.label}</span>
              </label>
            ) : (
              <Label htmlFor={`${id}-${spec.key}`}>{spec.label}</Label>
            )}
            {spec.kind === "choice" && (
              <RemoteChoice
                formId={formId}
                provider={app.provider}
                spec={spec}
                parent={spec.parent ? str(spec.parent) : undefined}
                value={str(spec.key)}
                onChange={(v) => set(spec.key, v)}
              />
            )}
            {spec.kind === "static" && (
              <Picker
                label={spec.label}
                value={str(spec.key)}
                options={spec.options}
                onChange={(v) => set(spec.key, v)}
              />
            )}
            {spec.kind === "field" &&
              (fields.status === "ready" ? (
                <Picker
                  label={spec.label}
                  optional={spec.optional}
                  value={str(spec.key)}
                  options={fieldList
                    .filter((f) => fieldMatches(f, spec.types))
                    .map((f) => ({ id: f.key, name: f.label }))}
                  onChange={(v) => set(spec.key, v)}
                />
              ) : (
                <p className="text-muted-foreground text-sm">
                  {fields.status === "loading"
                    ? "Loading…"
                    : "Choose the destination first."}
                </p>
              ))}
            {spec.kind === "question" && (
              <Picker
                label={spec.label}
                optional={spec.optional}
                value={str(spec.key)}
                options={questions
                  .filter((q) => spec.types.includes(q.type))
                  .map((q) => ({ id: q.id, name: q.label }))}
                onChange={(v) => set(spec.key, v)}
              />
            )}
            {spec.kind === "source" && (
              <Picker
                label={spec.label}
                value={str(spec.key)}
                options={sources.map((s) => ({ id: s.value, name: s.label }))}
                onChange={(v) => set(spec.key, v)}
              />
            )}
            {spec.kind === "tags" && (
              <Input
                id={`${id}-${spec.key}`}
                placeholder="newsletter, webinar"
                defaultValue={((settings[spec.key] as string[] | undefined) ?? []).join(
                  ", ",
                )}
                onChange={(e) =>
                  set(
                    spec.key,
                    e.target.value
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean)
                      .slice(0, 10),
                  )
                }
              />
            )}
            {spec.help && (
              <span className="text-muted-foreground text-xs">{spec.help}</span>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold">Fields</span>
        {fields.status === "error" && (
          <p className="text-destructive text-sm">{fields.message}</p>
        )}
        {fields.status === "loading" && (
          <p className="text-muted-foreground text-sm">Loading fields…</p>
        )}
        {fields.status === "ready" && (
          <MappingEditor
            fields={fieldList}
            sources={sources}
            rows={mapping}
            onChange={setMapping}
            reserved={reserved}
          />
        )}
        {missing.length > 0 && (
          <p role="status" className="text-sm text-[var(--alert-warning-fg)]">
            Required in {app.label}: {missing.map((f) => f.label).join(", ")}.
          </p>
        )}
        {unsupported.length > 0 && (
          <p className="text-muted-foreground text-xs">
            Can&apos;t be filled from a form:{" "}
            {unsupported.map((f) => `${f.label} (${f.type})`).join(", ")}.
          </p>
        )}
        <span className="text-muted-foreground text-xs">{app.dedupe}</span>
      </div>

      {schema && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Only when</span>
          <ConditionEditor
            schema={schema}
            value={condition}
            onChange={setCondition}
            label="Only when"
          />
          {!condition && (
            <span className="text-muted-foreground text-xs">
              No conditions: every completed response.
            </span>
          )}
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          aria-label={`Send responses to ${app.label}`}
        />
        On
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <ButtonSpinner />}
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
        {initial && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive ml-auto"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await deleteConnectorLinkAction(formId, app.provider);
                if (r.ok) onDone("removed");
                else toast.error(r.message);
              })
            }
          >
            Stop sending to {app.label}
          </Button>
        )}
      </div>
    </form>
  );
}

function AppCard({
  formId,
  app,
  state,
  canManage,
  schema,
  sources,
  questions,
}: {
  formId: string;
  app: AppInfo;
  state: AppState;
  canManage: boolean;
  schema: FormSchemaV1 | null;
  sources: Option[];
  questions: QuestionOption[];
}) {
  const [link, setLink] = useState(state.link);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const connectHref = `/api/connectors/${app.provider}/authorize?returnTo=${encodeURIComponent(`/forms/${formId}/integrations`)}`;
  const connected = state.connection?.status === "ok";

  return (
    <div
      className="border-border flex flex-col gap-3 rounded-sm border-[1.5px] p-3.5"
      aria-label={app.label}
      role="group"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">{app.label}</h3>
          <p className="text-muted-foreground text-sm">{app.description}</p>
          {state.connection && (
            <p
              className={
                connected
                  ? "mt-1 flex items-center gap-1.5 text-sm text-[var(--alert-success-fg)]"
                  : "mt-1 flex items-center gap-1.5 text-sm text-[var(--alert-error-fg)]"
              }
            >
              {connected ? (
                <CircleCheck className="size-4" />
              ) : (
                <CircleAlert className="size-4" />
              )}
              {connected
                ? `Connected${state.connection.label ? ` as ${state.connection.label}` : ""}`
                : "The connection stopped working. Reconnect it."}
            </p>
          )}
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {!connected && (
              <Button asChild size="sm">
                <a href={connectHref}>
                  {state.connection ? "Reconnect" : `Connect ${app.label}`}
                </a>
              </Button>
            )}
            {state.connection &&
              (confirming ? (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await disconnectAppAction(formId, app.provider);
                      if (r.ok) toast.success(`${app.label} disconnected.`);
                      else toast.error(r.message);
                      setConfirming(false);
                    })
                  }
                >
                  {pending && <ButtonSpinner />}
                  Disconnect for every form
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
                  Disconnect
                </Button>
              ))}
          </div>
        )}
      </div>

      {link && !editing && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            {link.enabled ? "On" : "Off"} · {link.mapping.length} field
            {link.mapping.length === 1 ? "" : "s"} mapped
            {link.condition ? " · only when its condition matches" : ""}
          </span>
          {canManage && connected && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </div>
      )}
      {!link && !editing && canManage && connected && (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() => setEditing(true)}
        >
          Send this form&apos;s responses
        </Button>
      )}
      {editing && (
        <LinkEditor
          formId={formId}
          app={app}
          initial={link}
          schema={schema}
          sources={sources}
          questions={questions}
          onDone={(saved) => {
            if (saved === "removed") setLink(null);
            else if (saved) setLink(saved);
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}

/** Business apps (master spec Phase 6): connect once per workspace, then
 * choose per form where its responses go and how answers map. */
export function AppsPanel({
  formId,
  apps,
  canManage,
  schema,
  sources,
  questions,
}: {
  formId: string;
  apps: AppState[];
  canManage: boolean;
  schema: FormSchemaV1 | null;
  sources: Option[];
  questions: QuestionOption[];
}) {
  const byProvider = useMemo(() => new Map(apps.map((a) => [a.provider, a])), [apps]);
  return (
    <div className="flex flex-col gap-3">
      {!canManage && (
        <p className="text-muted-foreground text-sm">
          Ask a workspace admin for permission to manage integrations to change these.
        </p>
      )}
      {APPS.filter((a) => byProvider.has(a.provider)).map((app) => (
        <AppCard
          key={app.provider}
          formId={formId}
          app={app}
          state={byProvider.get(app.provider)!}
          canManage={canManage}
          schema={schema}
          sources={sources}
          questions={questions}
        />
      ))}
    </div>
  );
}
