"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import {
  deleteNotificationRuleAction,
  saveDigestAction,
  saveNotificationRuleAction,
} from "@/app/(form)/forms/[id]/(sections)/integrations/notification-actions";
import type { NotificationRule } from "@/domains/notifications/rules";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { DOCUMENT_KIND_LABEL, type DocumentKind } from "@/domains/documents/settings";
import { ConditionEditor } from "@/components/builder/logic/condition-editor";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/lib/toast";

type Option = { id: string; label: string };
type Draft = Omit<NotificationRule, "id"> & { id: string | null };

const NO_PDF = "__none";

function Teammates({
  members,
  value,
  onChange,
  idPrefix,
}: {
  members: Option[];
  value: string[];
  onChange: (next: string[]) => void;
  idPrefix: string;
}) {
  if (members.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nobody on this team can see responses yet.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5" role="group" aria-label="Teammates">
      {members.map((m) => (
        <label key={m.id} className="flex items-center gap-2 text-sm">
          <Checkbox
            id={`${idPrefix}-${m.id}`}
            checked={value.includes(m.id)}
            onCheckedChange={(on) =>
              onChange(on ? [...value, m.id] : value.filter((x) => x !== m.id))
            }
          />
          {m.label}
        </label>
      ))}
    </div>
  );
}

function RuleEditor({
  formId,
  schema,
  members,
  documents,
  draft: initial,
  onDone,
}: {
  formId: string;
  schema: FormSchemaV1 | null;
  members: Option[];
  documents: DocumentKind[];
  draft: Draft;
  onDone: (saved: NotificationRule | null) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [pending, start] = useTransition();
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const idPrefix = `rule-${draft.id ?? "new"}`;

  return (
    <form
      className="bg-background flex flex-col gap-3.5 rounded-sm p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const { id, ...input } = draft;
          const result = await saveNotificationRuleAction(formId, id, input);
          if (result.ok) {
            toast.success("Saved.");
            onDone({ ...input, id: result.id ?? id ?? "" });
          } else toast.error(result.message);
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-name`}>Name</Label>
          <Input
            id={`${idPrefix}-name`}
            maxLength={120}
            placeholder="Big orders to sales"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-subject`}>Subject</Label>
          <Input
            id={`${idPrefix}-subject`}
            maxLength={200}
            placeholder="New response: {{form}}"
            value={draft.subject ?? ""}
            onChange={(e) => set({ subject: e.target.value || undefined })}
          />
          <span className="text-muted-foreground text-xs">
            Use {"{{form}}"}, {"{{answer:…}}"} or a variable like {"{{score}}"}.
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold">Send to</span>
        <Teammates
          members={members}
          value={draft.memberIds}
          onChange={(memberIds) => set({ memberIds })}
          idPrefix={idPrefix}
        />
      </div>
      {schema && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Only when</span>
          <ConditionEditor
            schema={schema}
            value={draft.condition}
            onChange={(condition) => set({ condition })}
            label="Only when"
          />
          {!draft.condition && (
            <span className="text-muted-foreground text-xs">
              No conditions: every completed response.
            </span>
          )}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="flex flex-col">
            <b>Include the answers</b>
            <span className="text-muted-foreground text-xs">
              Off: the email links to the response instead.
            </span>
          </span>
          <Switch
            checked={draft.includeAnswers}
            onCheckedChange={(includeAnswers) => set({ includeAnswers })}
          />
        </label>
        {documents.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <Label>Attach a PDF</Label>
            <Select
              value={draft.attachDocument ?? NO_PDF}
              onValueChange={(v) =>
                set({ attachDocument: v === NO_PDF ? undefined : (v as DocumentKind) })
              }
            >
              <SelectTrigger className="w-full" aria-label="Attach a PDF">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PDF}>No attachment</SelectItem>
                {documents.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {DOCUMENT_KIND_LABEL[kind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={draft.enabled} onCheckedChange={(enabled) => set({ enabled })} />
        On
      </label>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <ButtonSpinner />}
          Save rule
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Notification rules and the daily digest (F-25). Recipients are
 * teammates who can see responses. */
export function NotificationRulesPanel({
  formId,
  schema,
  members,
  documents,
  initialRules,
  initialDigest,
}: {
  formId: string;
  schema: FormSchemaV1 | null;
  members: Option[];
  documents: DocumentKind[];
  initialRules: NotificationRule[];
  initialDigest: { enabled: boolean; memberIds: string[]; timeZone: string } | null;
}) {
  const [rules, setRules] = useState(initialRules);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [digest, setDigest] = useState(
    initialDigest ?? {
      enabled: false,
      memberIds: [],
      timeZone:
        typeof Intl !== "undefined"
          ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
          : "UTC",
    },
  );
  const [pending, start] = useTransition();
  const blank: Draft = {
    id: null,
    name: "",
    enabled: true,
    memberIds: [],
    includeAnswers: false,
  };
  const memberName = new Map(members.map((m) => [m.id, m.label]));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2.5">
        <h3 className="text-sm font-bold">Rules</h3>
        {rules.length === 0 && editing !== "new" && (
          <p className="text-muted-foreground text-sm">
            Email teammates about responses that match, like orders over a size or a low
            score.
          </p>
        )}
        {rules.map((rule) =>
          editing === rule.id ? (
            <RuleEditor
              key={rule.id}
              formId={formId}
              schema={schema}
              members={members}
              documents={documents}
              draft={rule}
              onDone={(saved) => {
                if (saved) setRules((r) => r.map((x) => (x.id === rule.id ? saved : x)));
                setEditing(null);
              }}
            />
          ) : (
            <div
              key={rule.id}
              className="border-border flex flex-wrap items-center gap-3 rounded-sm border-[1.5px] px-3.5 py-2.5"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <b className="text-sm">{rule.name}</b>
                <span className="text-muted-foreground truncate text-xs">
                  {rule.enabled ? "On" : "Off"} ·{" "}
                  {rule.condition ? "When it matches" : "Every response"} ·{" "}
                  {rule.memberIds
                    .map((id) => memberName.get(id) ?? "Former teammate")
                    .join(", ")}
                </span>
              </div>
              <Button size="sm" variant="outline" onClick={() => setEditing(rule.id)}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const result = await deleteNotificationRuleAction(formId, rule.id);
                    if (result.ok) setRules((r) => r.filter((x) => x.id !== rule.id));
                    else toast.error(result.message);
                  })
                }
              >
                Delete
              </Button>
            </div>
          ),
        )}
        {editing === "new" ? (
          <RuleEditor
            formId={formId}
            schema={schema}
            members={members}
            documents={documents}
            draft={blank}
            onDone={(saved) => {
              if (saved) setRules((r) => [...r, saved]);
              setEditing(null);
            }}
          />
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            onClick={() => setEditing("new")}
          >
            <Plus className="size-4" />
            Add a rule
          </Button>
        )}
      </div>

      <form
        className="border-border flex flex-col gap-3 border-t pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const result = await saveDigestAction(formId, digest);
            if (result.ok) toast.success("Saved.");
            else toast.error(result.message);
          });
        }}
      >
        <label className="flex items-center justify-between gap-3">
          <span className="flex flex-col">
            <b className="text-sm">Daily digest</b>
            <span className="text-muted-foreground text-xs">
              Yesterday&apos;s counts, once a day. Nothing is sent on a day without
              responses.
            </span>
          </span>
          <Switch
            checked={digest.enabled}
            onCheckedChange={(enabled) => setDigest((d) => ({ ...d, enabled }))}
          />
        </label>
        {digest.enabled && (
          <>
            <Teammates
              members={members}
              value={digest.memberIds}
              onChange={(memberIds) => setDigest((d) => ({ ...d, memberIds }))}
              idPrefix="digest"
            />
            <div className="flex max-w-xs flex-col gap-1.5">
              <Label htmlFor="digest-zone">Time zone</Label>
              <Input
                id="digest-zone"
                value={digest.timeZone}
                onChange={(e) => setDigest((d) => ({ ...d, timeZone: e.target.value }))}
              />
            </div>
          </>
        )}
        <Button type="submit" size="sm" className="self-start" disabled={pending}>
          {pending && <ButtonSpinner />}
          Save digest
        </Button>
      </form>
    </div>
  );
}
