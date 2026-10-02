"use client";

import { useState, useTransition } from "react";
import { saveConfirmationAction } from "@/app/(form)/forms/[id]/(sections)/integrations/actions";
import type { ConfirmationSettings } from "@/domains/notifications/confirmation";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/lib/toast";

/** Confirmation emails to respondents (P2.18): to the address they gave
 * in the chosen question, once per response. */
export function ConfirmationPanel({
  formId,
  initial,
  emailQuestions,
  allowed,
  emailConfigured,
}: {
  formId: string;
  initial: ConfirmationSettings;
  emailQuestions: { id: string; label: string }[];
  allowed: boolean;
  emailConfigured: boolean;
}) {
  const [settings, setSettings] = useState(initial);
  const [pending, start] = useTransition();
  const set = (patch: Partial<ConfirmationSettings>) =>
    setSettings((s) => ({ ...s, ...patch }));

  if (!allowed && !initial.enabled) {
    return (
      <p className="text-muted-foreground text-sm">
        Confirmation emails are part of paid plans. See Settings → Plan.
      </p>
    );
  }
  if (emailQuestions.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Add an Email question (or a Contact info block that asks for email) to send
        respondents a confirmation.
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await saveConfirmationAction(formId, settings);
          if (result.ok) toast.success("Saved.");
          else toast.error(result.message);
        });
      }}
    >
      {!emailConfigured && (
        <p className="text-[13px] text-[var(--chip-draft-fg)]">
          Email isn&apos;t set up on this server yet (RESEND_API_KEY), so nothing will be
          sent until it is.
        </p>
      )}
      <label className="bg-background flex items-center justify-between gap-3 rounded-sm px-3 py-2.5">
        <b className="text-sm">Send respondents a confirmation</b>
        <Switch
          checked={settings.enabled}
          onCheckedChange={(enabled) => set({ enabled })}
        />
      </label>
      <div className="grid gap-1.5">
        <Label htmlFor="confirm-to">Send to the address from</Label>
        <Select
          value={settings.recipientQuestionId ?? ""}
          onValueChange={(recipientQuestionId) => set({ recipientQuestionId })}
        >
          <SelectTrigger id="confirm-to" className="w-full">
            <SelectValue placeholder="Choose a question" />
          </SelectTrigger>
          <SelectContent>
            {emailQuestions.map((q) => (
              <SelectItem key={q.id} value={q.id}>
                {q.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="confirm-subject">Subject</Label>
        <Input
          id="confirm-subject"
          value={settings.subject}
          maxLength={150}
          onChange={(e) => set({ subject: e.target.value })}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="confirm-body">Message</Label>
        <Textarea
          id="confirm-body"
          rows={5}
          value={settings.body}
          maxLength={4000}
          onChange={(e) => set({ body: e.target.value })}
        />
        <span className="text-muted-foreground text-xs">
          Plain text. Use {"{{answer:question-id}}"} or a variable like {"{{score}}"} to
          include answers.
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="confirm-cta-label">Button (optional)</Label>
          <Input
            id="confirm-cta-label"
            value={settings.ctaLabel ?? ""}
            maxLength={60}
            placeholder="Book a call"
            onChange={(e) => set({ ctaLabel: e.target.value || null })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="confirm-cta-url">Button link</Label>
          <Input
            id="confirm-cta-url"
            type="url"
            value={settings.ctaUrl ?? ""}
            placeholder="https://example.com/book"
            onChange={(e) => set({ ctaUrl: e.target.value || null })}
          />
        </div>
      </div>
      <Button type="submit" className="self-start" disabled={pending}>
        {pending && <ButtonSpinner />}
        Save
      </Button>
    </form>
  );
}
