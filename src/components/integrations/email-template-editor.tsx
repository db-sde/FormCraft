"use client";

import { useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Mail, Trash2 } from "lucide-react";
import {
  loadTemplateEditorAction,
  previewTemplateAction,
  resetTemplateAction,
  saveTemplateAction,
  saveWorkspaceTemplateAction,
  sendTestTemplateAction,
  type TemplateEditorData,
} from "@/app/(dashboard)/email-template-actions";
import type { EmailTemplate, TemplateBlock } from "@/domains/email-templates/schema";
import { KIND_LABEL } from "@/domains/email-templates/schema";
import type { TemplateTarget } from "@/domains/email-templates/queries";
import { ImageUploadField } from "@/components/builder/image-upload-field";
import { Button, ButtonSpinner } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";

const BLOCK_LABEL: Record<TemplateBlock["type"], string> = {
  text: "Text",
  heading: "Heading",
  image: "Image",
  button: "Button",
  divider: "Divider",
  answers: "All answers",
  spacer: "Spacer",
};

function newBlock(type: TemplateBlock["type"]): TemplateBlock {
  switch (type) {
    case "text":
      return { type, text: "" };
    case "heading":
      return { type, text: "Heading" };
    case "image":
      return { type, url: "", alt: "" };
    case "button":
      return { type, label: "Open", url: "https://" };
    case "divider":
      return { type };
    case "answers":
      return { type };
    case "spacer":
      return { type, size: 24 };
  }
}

/**
 * The custom email template editor (developer spec item 2; Starter and
 * up): subject, preheader, sender name, reply-to and body blocks, with
 * merge tags from a picker, a live preview, test sends, workspace
 * templates and reset to default.
 */
export function EmailTemplateButton({
  target,
  label = "Customise email",
}: {
  target: TemplateTarget;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<TemplateEditorData | null>(null);
  const [loading, startLoad] = useTransition();
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={loading}
        onClick={() =>
          startLoad(async () => {
            const result = await loadTemplateEditorAction(target);
            if (!result.ok) {
              toast.error(result.message);
              return;
            }
            setData(result.data);
            setOpen(true);
          })
        }
      >
        {loading ? <ButtonSpinner /> : <Mail />} {label}
      </Button>
      {data && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[min(1100px,calc(100%-2rem))]">
            <Editor
              key={JSON.stringify(data.template)}
              target={target}
              data={data}
              onClose={() => setOpen(false)}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function Editor({
  target,
  data,
  onClose,
}: {
  target: TemplateTarget;
  data: TemplateEditorData;
  onClose: () => void;
}) {
  const [t, setT] = useState<EmailTemplate>(data.template);
  const [isCustom, setIsCustom] = useState(data.isCustom);
  const [saved, setSaved] = useState(data.saved);
  const [preview, setPreview] = useState<{ html: string; subject: string } | null>(null);
  const [saveName, setSaveName] = useState("");
  const [pending, start] = useTransition();
  // Where the next merge tag goes: the field last typed in.
  const focused = useRef<{
    el: HTMLInputElement | HTMLTextAreaElement;
    apply: (v: string) => void;
  } | null>(null);
  const disabled = !data.allowed || !data.canManage;

  const set = (patch: Partial<EmailTemplate>) => setT((cur) => ({ ...cur, ...patch }));
  const setBlock = (i: number, block: TemplateBlock) =>
    setT((cur) => ({ ...cur, blocks: cur.blocks.map((b, j) => (j === i ? block : b)) }));
  const move = (i: number, d: -1 | 1) =>
    setT((cur) => {
      const blocks = [...cur.blocks];
      const j = i + d;
      if (j < 0 || j >= blocks.length) return cur;
      [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
      return { ...cur, blocks };
    });

  function track(apply: (v: string) => void) {
    return {
      onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        focused.current = { el: e.currentTarget, apply };
      },
    };
  }

  function insertTag(tag: string) {
    const f = focused.current;
    if (!f) {
      toast.message("Click into a field first, then pick a merge tag.");
      return;
    }
    const el = f.el;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    f.apply(el.value.slice(0, start) + tag + el.value.slice(end));
  }

  function run(fn: () => Promise<void>) {
    start(async () => {
      try {
        await fn();
      } catch {
        toast.error("Something went wrong. Try again.");
      }
    });
  }

  const textField = (
    value: string,
    onValue: (v: string) => void,
    props: { id: string; max: number; multiline?: boolean; placeholder?: string },
  ) =>
    props.multiline ? (
      <Textarea
        id={props.id}
        rows={4}
        maxLength={props.max}
        placeholder={props.placeholder}
        value={value}
        onChange={(e) => onValue(e.target.value)}
        {...track(onValue)}
      />
    ) : (
      <Input
        id={props.id}
        maxLength={props.max}
        placeholder={props.placeholder}
        value={value}
        onChange={(e) => onValue(e.target.value)}
        {...track(onValue)}
      />
    );

  return (
    <>
      <DialogHeader>
        <DialogTitle>{KIND_LABEL[data.kind]}</DialogTitle>
        <DialogDescription>
          {isCustom
            ? "This email uses your template."
            : "This email uses FormCraft's standard email."}{" "}
          Every send counts against the workspace&apos;s monthly emails; test sends
          don&apos;t.
        </DialogDescription>
      </DialogHeader>
      {data.planMessage && (
        <p className="text-muted-foreground text-sm">{data.planMessage}</p>
      )}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
        <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="et-subject">Subject</Label>
              {textField(t.subject, (subject) => set({ subject }), {
                id: "et-subject",
                max: 150,
              })}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="et-pre">Preheader (preview line)</Label>
              {textField(t.preheader ?? "", (preheader) => set({ preheader }), {
                id: "et-pre",
                max: 120,
              })}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="et-sender">Sender name</Label>
              <Input
                id="et-sender"
                maxLength={60}
                placeholder="Acme Events"
                value={t.senderName ?? ""}
                onChange={(e) => set({ senderName: e.target.value || undefined })}
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="et-reply">Replies go to</Label>
              <div className="flex flex-wrap gap-2">
                <select
                  id="et-reply"
                  className="border-input h-9 rounded-sm border-[1.5px] bg-transparent px-2 text-sm"
                  value={
                    t.replyTo.mode === "answer"
                      ? `answer:${t.replyTo.questionId}`
                      : t.replyTo.mode
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "owner") set({ replyTo: { mode: "owner" } });
                    else if (v === "fixed")
                      set({ replyTo: { mode: "fixed", address: "" } });
                    else set({ replyTo: { mode: "answer", questionId: v.slice(7) } });
                  }}
                >
                  <option value="owner">The workspace owner</option>
                  <option value="fixed">An address you choose</option>
                  {data.questions
                    .filter((q) => q.isEmail)
                    .map((q) => (
                      <option key={q.id} value={`answer:${q.id}`}>
                        The answer to “{q.label.slice(0, 40)}”
                      </option>
                    ))}
                </select>
                {t.replyTo.mode === "fixed" && (
                  <Input
                    aria-label="Reply-to address"
                    type="email"
                    className="h-9 max-w-[260px]"
                    value={t.replyTo.address}
                    onChange={(e) =>
                      set({ replyTo: { mode: "fixed", address: e.target.value } })
                    }
                  />
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground text-xs font-semibold">Insert:</span>
            <select
              aria-label="Insert a merge tag"
              className="border-input h-8 rounded-sm border-[1.5px] bg-transparent px-1.5 text-xs"
              value=""
              onChange={(e) => e.target.value && insertTag(e.target.value)}
            >
              <option value="">Merge tag…</option>
              <optgroup label="Answers">
                {data.questions.map((q) => (
                  <option key={q.id} value={`{{answer:${q.id}}}`}>
                    {q.label.slice(0, 50)}
                  </option>
                ))}
              </optgroup>
              {data.hiddenFields.length > 0 && (
                <optgroup label="Hidden fields">
                  {data.hiddenFields.map((h) => (
                    <option key={h} value={`{{hidden:${h}}}`}>
                      {h}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Response">
                {data.mergeTags.map((m) => (
                  <option key={m.tag} value={m.tag}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
            </select>
            <span className="text-muted-foreground text-xs">
              A blank answer can fall back: {'{{answer:q1 | "there"}}'}. Text: **bold**,
              *italic*, [link](https://…), “- ” for lists.
            </span>
          </div>

          <ol className="flex flex-col gap-2">
            {t.blocks.map((block, i) => (
              <li
                key={i}
                className="border-border flex flex-col gap-2 rounded-sm border-[1.5px] p-2.5"
              >
                <div className="flex items-center gap-1">
                  <span className="text-xs font-semibold">{BLOCK_LABEL[block.type]}</span>
                  <span className="flex-1" />
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Move up"
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Move down"
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Remove block"
                    disabled={t.blocks.length === 1}
                    onClick={() => set({ blocks: t.blocks.filter((_, j) => j !== i) })}
                  >
                    <Trash2 />
                  </Button>
                </div>
                {block.type === "text" &&
                  textField(block.text, (text) => setBlock(i, { ...block, text }), {
                    id: `et-b${i}`,
                    max: 4000,
                    multiline: true,
                  })}
                {block.type === "heading" &&
                  textField(block.text, (text) => setBlock(i, { ...block, text }), {
                    id: `et-b${i}`,
                    max: 200,
                  })}
                {block.type === "button" && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {textField(block.label, (label) => setBlock(i, { ...block, label }), {
                      id: `et-b${i}`,
                      max: 60,
                      placeholder: "Label",
                    })}
                    <Input
                      aria-label="Button link"
                      maxLength={2000}
                      value={block.url}
                      onChange={(e) => setBlock(i, { ...block, url: e.target.value })}
                    />
                  </div>
                )}
                {block.type === "image" && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <ImageUploadField
                      label="Image"
                      workspaceId={data.workspaceId}
                      formId={data.formId ?? "email-templates"}
                      value={block.url || undefined}
                      onChange={(url) => setBlock(i, { ...block, url: url ?? "" })}
                    />
                    <Input
                      aria-label="Image description"
                      placeholder="Describe the image"
                      maxLength={200}
                      value={block.alt}
                      onChange={(e) => setBlock(i, { ...block, alt: e.target.value })}
                    />
                  </div>
                )}
                {block.type === "spacer" && (
                  <Input
                    aria-label="Space in pixels"
                    type="number"
                    min={8}
                    max={64}
                    value={block.size}
                    onChange={(e) =>
                      setBlock(i, {
                        ...block,
                        size: Math.min(64, Math.max(8, Number(e.target.value) || 24)),
                      })
                    }
                    className="h-8 w-24"
                  />
                )}
                {block.type === "answers" && (
                  <p className="text-muted-foreground text-xs">
                    Each answer on the respondent&apos;s path, as a table.
                  </p>
                )}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(BLOCK_LABEL) as TemplateBlock["type"][]).map((type) => (
              <Button
                key={type}
                type="button"
                size="sm"
                variant="outline"
                disabled={t.blocks.length >= 60}
                onClick={() => set({ blocks: [...t.blocks, newBlock(type)] })}
              >
                + {BLOCK_LABEL[type]}
              </Button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <ImageUploadField
              label="Logo (instead of the form's)"
              noun="a logo"
              workspaceId={data.workspaceId}
              formId={data.formId ?? "email-templates"}
              value={t.brand.logoUrl}
              onChange={(logoUrl) => set({ brand: { ...t.brand, logoUrl } })}
            />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="et-accent">
                Button colour (instead of the form&apos;s)
              </Label>
              <div className="flex gap-2">
                <input
                  aria-label="Pick a button colour"
                  type="color"
                  value={t.brand.accentColor ?? "#f2b233"}
                  onChange={(e) =>
                    set({ brand: { ...t.brand, accentColor: e.target.value } })
                  }
                  className="border-input h-9 w-12 rounded-sm border-[1.5px]"
                />
                {t.brand.accentColor && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => set({ brand: { ...t.brand, accentColor: undefined } })}
                  >
                    Use the form&apos;s
                  </Button>
                )}
              </div>
            </div>
          </div>
          {data.kind === "rule" && data.ruleHasPdf && (
            <div className="flex items-center gap-2.5">
              <Switch
                id="et-pdf"
                checked={t.attachPdf !== false}
                onCheckedChange={(attachPdf) => set({ attachPdf })}
              />
              <Label htmlFor="et-pdf">Attach the response PDF</Label>
            </div>
          )}
        </fieldset>

        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Preview</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const r = await previewTemplateAction(target, t);
                  if (r.ok) setPreview({ html: r.html, subject: r.subject });
                  else toast.error(r.message);
                })
              }
            >
              Refresh preview
            </Button>
          </div>
          {preview ? (
            <>
              <p className="truncate text-sm">
                <b>Subject:</b> {preview.subject}
              </p>
              <iframe
                title="Email preview"
                sandbox=""
                srcDoc={preview.html}
                className="border-border h-[520px] w-full rounded-sm border-[1.5px] bg-white"
              />
            </>
          ) : (
            <p className="text-muted-foreground border-border grid h-[200px] place-items-center rounded-sm border-[1.5px] border-dashed text-sm">
              Refresh to see it with your latest response, or sample answers.
            </p>
          )}
        </div>
      </div>

      {!disabled && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const r = await saveTemplateAction(target, t);
                if (r.ok) {
                  setIsCustom(true);
                  toast.success("Template saved.");
                } else toast.error(r.message);
              })
            }
          >
            {pending && <ButtonSpinner />} Save template
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const r = await sendTestTemplateAction(target, t);
                if (r.ok) toast.success(`Test sent to ${r.to}.`);
                else toast.error(r.message);
              })
            }
          >
            Send test to me
          </Button>
          {saved.length > 0 && (
            <select
              aria-label="Start from a saved template"
              className="border-input h-9 rounded-sm border-[1.5px] bg-transparent px-2 text-sm"
              value=""
              onChange={(e) => {
                const s = saved.find((x) => x.id === e.target.value);
                if (s) setT(s.template);
              }}
            >
              <option value="">Start from a saved template…</option>
              {saved.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <span className="flex-1" />
          <Input
            aria-label="Workspace template name"
            placeholder="Name to save as a workspace template"
            maxLength={60}
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            className="h-9 w-[240px]"
          />
          <Button
            type="button"
            variant="outline"
            disabled={pending || !saveName.trim()}
            onClick={() =>
              run(async () => {
                const r = await saveWorkspaceTemplateAction(saveName, t);
                if (r.ok) {
                  setSaved((list) => [r.saved, ...list]);
                  setSaveName("");
                  toast.success("Saved for the workspace.");
                } else toast.error(r.message);
              })
            }
          >
            Save as workspace template
          </Button>
          {isCustom && (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const r = await resetTemplateAction(target);
                  if (r.ok) {
                    toast.success("Back to FormCraft's standard email.");
                    onClose();
                  } else toast.error(r.message);
                })
              }
            >
              Reset to default
            </Button>
          )}
        </div>
      )}
    </>
  );
}
