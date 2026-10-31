"use client";

import { useState, useTransition } from "react";
import { FileText } from "lucide-react";
import {
  removeDocumentAction,
  saveDocumentAction,
} from "@/app/(form)/forms/[id]/(sections)/integrations/document-actions";
import {
  DEFAULT_HEADING,
  DOCUMENT_KIND_HINT,
  DOCUMENT_KIND_LABEL,
  DOCUMENT_KINDS,
  DOCUMENT_RECIPIENTS,
  DOCUMENT_RECIPIENTS_LABEL,
  documentNumber,
  type DocumentKind,
  type DocumentRecipients,
  type DocumentSettings,
} from "@/domains/documents/settings";
import type { Condition } from "@/domains/forms/schema/logic-model";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ImageUploadField } from "@/components/builder/image-upload-field";
import { toast } from "@/lib/toast";

export type DocumentRow = {
  kind: DocumentKind;
  enabled: boolean;
  settings: DocumentSettings;
  recipients: DocumentRecipients;
  memberIds: string[];
};

type Option = { id: string; label: string };

const NONE = "__none";

/** "score ≥ 80" as a condition, and back. */
function minimumRule(condition: Condition | undefined) {
  if (
    condition?.type === "compare" &&
    condition.op === "gte" &&
    condition.left.type === "variable" &&
    condition.right?.type === "literal" &&
    typeof condition.right.value === "number"
  ) {
    return { variableId: condition.left.variableId, min: condition.right.value };
  }
  return null;
}

function DocumentEditor({
  formId,
  workspaceId,
  row,
  emailQuestions,
  nameQuestions,
  endings,
  variables,
  members,
  onDone,
}: {
  formId: string;
  workspaceId: string;
  row: DocumentRow;
  emailQuestions: Option[];
  nameQuestions: Option[];
  endings: Option[];
  variables: Option[];
  members: Option[];
  onDone: (row: DocumentRow | null) => void;
}) {
  const [draft, setDraft] = useState(row);
  const [pending, start] = useTransition();
  const s = draft.settings;
  const set = (patch: Partial<DocumentSettings>) =>
    setDraft((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  const rule = minimumRule(s.condition);
  const customRule = s.condition && !rule;
  const id = (name: string) => `doc-${draft.kind}-${name}`;

  return (
    <form
      className="bg-background flex flex-col gap-3.5 rounded-sm p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await saveDocumentAction(formId, draft);
          if (result.ok) {
            toast.success("Saved.");
            onDone(draft);
          } else toast.error(result.message);
        });
      }}
    >
      <label className="flex items-center justify-between gap-3">
        <b className="text-sm">Issue this document</b>
        <Switch
          checked={draft.enabled}
          onCheckedChange={(enabled) => setDraft((d) => ({ ...d, enabled }))}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id("heading")}>Heading</Label>
          <Input
            id={id("heading")}
            maxLength={120}
            placeholder={DEFAULT_HEADING[draft.kind]}
            value={s.heading ?? ""}
            onChange={(e) => set({ heading: e.target.value || undefined })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id("prefix")}>Number prefix</Label>
          <Input
            id={id("prefix")}
            maxLength={12}
            placeholder="e.g. INV-"
            value={s.numberPrefix ?? ""}
            onChange={(e) =>
              set({
                numberPrefix: e.target.value.replace(/[^A-Za-z0-9-]/g, "") || undefined,
              })
            }
          />
          <span className="text-muted-foreground text-xs">
            Numbers count up per form: {documentNumber(s, 1)}, {documentNumber(s, 2)}…
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id("intro")}>
          {draft.kind === "certificate"
            ? "Line above the name"
            : "Text under the heading"}
        </Label>
        <Textarea
          id={id("intro")}
          rows={2}
          maxLength={1000}
          placeholder={
            draft.kind === "certificate"
              ? "This certifies that"
              : "Thanks for your response."
          }
          value={s.intro ?? ""}
          onChange={(e) => set({ intro: e.target.value || undefined })}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id("footer")}>Footer</Label>
          <Input
            id={id("footer")}
            maxLength={300}
            placeholder="Your organisation, address or contact"
            value={s.footer ?? ""}
            onChange={(e) => set({ footer: e.target.value || undefined })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id("color")}>Colour</Label>
          <Input
            id={id("color")}
            type="color"
            className="h-9 p-1"
            value={s.color ?? "#1d4ed8"}
            onChange={(e) => set({ color: e.target.value })}
          />
        </div>
      </div>
      <ImageUploadField
        label="Logo"
        noun="a logo"
        workspaceId={workspaceId}
        formId={formId}
        value={s.logoUrl}
        onChange={(logoUrl) => set({ logoUrl })}
      />

      {draft.kind === "certificate" && (
        <fieldset className="border-border flex flex-col gap-2.5 rounded-sm border p-3">
          <legend className="px-1 text-sm font-bold">Who earns it</legend>
          <p className="text-muted-foreground text-xs">
            Only responses that meet this get a certificate. Pick an ending, a minimum
            score, or both.
          </p>
          {endings.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">Reached one of these endings</span>
              {endings.map((ending) => (
                <label key={ending.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={s.endingIds?.includes(ending.id) ?? false}
                    onCheckedChange={(on) => {
                      const next = new Set(s.endingIds ?? []);
                      if (on) next.add(ending.id);
                      else next.delete(ending.id);
                      set({ endingIds: next.size ? [...next] : undefined });
                    }}
                  />
                  {ending.label}
                </label>
              ))}
            </div>
          )}
          {customRule ? (
            <p className="text-muted-foreground text-xs">
              A custom rule is set and kept.
            </p>
          ) : (
            variables.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
                <div className="flex flex-col gap-1.5">
                  <Label>Score at least</Label>
                  <Select
                    value={rule?.variableId ?? NONE}
                    onValueChange={(variableId) =>
                      set({
                        condition:
                          variableId === NONE
                            ? undefined
                            : {
                                type: "compare",
                                left: { type: "variable", variableId },
                                op: "gte",
                                right: { type: "literal", value: rule?.min ?? 0 },
                              },
                      })
                    }
                  >
                    <SelectTrigger className="w-full" aria-label="Score variable">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No minimum</SelectItem>
                      {variables.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={id("min")}>Minimum</Label>
                  <Input
                    id={id("min")}
                    type="number"
                    disabled={!rule}
                    value={rule?.min ?? ""}
                    onChange={(e) =>
                      rule &&
                      set({
                        condition: {
                          type: "compare",
                          left: { type: "variable", variableId: rule.variableId },
                          op: "gte",
                          right: { type: "literal", value: Number(e.target.value) || 0 },
                        },
                      })
                    }
                  />
                </div>
              </div>
            )
          )}
          <div className="flex flex-col gap-1.5">
            <Label>Name on the certificate</Label>
            <Select
              value={s.nameQuestionId ?? NONE}
              onValueChange={(v) => set({ nameQuestionId: v === NONE ? undefined : v })}
            >
              <SelectTrigger className="w-full" aria-label="Name question">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No name</SelectItem>
                {nameQuestions.map((q) => (
                  <SelectItem key={q.id} value={q.id}>
                    {q.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </fieldset>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label>Email it to</Label>
          <Select
            value={draft.recipients}
            onValueChange={(v) =>
              setDraft((d) => ({ ...d, recipients: v as DocumentRecipients }))
            }
          >
            <SelectTrigger className="w-full" aria-label="Email it to">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOCUMENT_RECIPIENTS.map((r) => (
                <SelectItem key={r} value={r}>
                  {DOCUMENT_RECIPIENTS_LABEL[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {(draft.recipients === "respondent" || draft.recipients === "both") && (
          <div className="flex flex-col gap-1.5">
            <Label>Respondent&apos;s email from</Label>
            <Select
              value={s.emailQuestionId ?? NONE}
              onValueChange={(v) => set({ emailQuestionId: v === NONE ? undefined : v })}
            >
              <SelectTrigger className="w-full" aria-label="Respondent email question">
                <SelectValue placeholder="Choose a question" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Choose a question</SelectItem>
                {emailQuestions.map((q) => (
                  <SelectItem key={q.id} value={q.id}>
                    {q.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      {members.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Also send to teammates</span>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {members.map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={draft.memberIds.includes(m.id)}
                  onCheckedChange={(on) =>
                    setDraft((d) => ({
                      ...d,
                      memberIds: on
                        ? [...d.memberIds, m.id]
                        : d.memberIds.filter((x) => x !== m.id),
                    }))
                  }
                />
                {m.label}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <ButtonSpinner />}
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** PDF documents (F-07): a ready-made template per kind, numbered per
 * form, rebuilt from the response whenever it's downloaded or sent. */
export function DocumentsPanel({
  formId,
  workspaceId,
  initial,
  emailQuestions,
  nameQuestions,
  endings,
  variables,
  members,
  emailConfigured,
}: {
  formId: string;
  workspaceId: string;
  initial: DocumentRow[];
  emailQuestions: Option[];
  nameQuestions: Option[];
  endings: Option[];
  variables: Option[];
  members: Option[];
  emailConfigured: boolean;
}) {
  const [rows, setRows] = useState(initial);
  const [editing, setEditing] = useState<DocumentKind | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-col gap-2.5">
      {!emailConfigured && (
        <p className="text-[13px] text-[var(--chip-draft-fg)]">
          Email isn&apos;t set up on this server yet (RESEND_API_KEY): documents can be
          downloaded from each response, but nothing is emailed until it is.
        </p>
      )}
      {DOCUMENT_KINDS.map((kind) => {
        const row = rows.find((r) => r.kind === kind);
        return (
          <div key={kind} className="border-border rounded-sm border-[1.5px]">
            <div className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
              <FileText className="text-muted-foreground size-4 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col">
                <b className="text-sm">{DOCUMENT_KIND_LABEL[kind]}</b>
                <span className="text-muted-foreground text-xs">
                  {row
                    ? `${row.enabled ? "On" : "Off"} · ${DOCUMENT_RECIPIENTS_LABEL[row.recipients]}${row.memberIds.length ? ` + ${row.memberIds.length} teammate${row.memberIds.length === 1 ? "" : "s"}` : ""}`
                    : DOCUMENT_KIND_HINT[kind]}
                </span>
              </div>
              {editing !== kind && (
                <Button size="sm" variant="outline" onClick={() => setEditing(kind)}>
                  {row ? "Edit" : "Set up"}
                </Button>
              )}
              {row && editing !== kind && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const result = await removeDocumentAction(formId, kind);
                      if (result.ok) setRows((r) => r.filter((x) => x.kind !== kind));
                      else toast.error(result.message);
                    })
                  }
                >
                  Remove
                </Button>
              )}
            </div>
            {editing === kind && (
              <div className="px-3.5 pb-3.5">
                <DocumentEditor
                  formId={formId}
                  workspaceId={workspaceId}
                  row={
                    row ?? {
                      kind,
                      enabled: true,
                      settings: {},
                      recipients: "none",
                      memberIds: [],
                    }
                  }
                  emailQuestions={emailQuestions}
                  nameQuestions={nameQuestions}
                  endings={endings}
                  variables={variables}
                  members={members}
                  onDone={(saved) => {
                    if (saved)
                      setRows((r) => [...r.filter((x) => x.kind !== kind), saved]);
                    setEditing(null);
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
