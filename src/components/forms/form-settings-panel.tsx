"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bell, Link2, ShieldCheck } from "lucide-react";
import {
  setNotificationsAction,
  updateSlugAction,
  updateUnfinishedSettingsAction,
} from "@/app/(form)/forms/[id]/settings/actions";
import type { FormSettings } from "@/domains/forms";
import { Button } from "@/components/ui/button";
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

const RETENTION_OPTIONS = [
  { value: "keep", label: "Keep until I delete them" },
  { value: "30", label: "Delete after 30 days" },
  { value: "90", label: "Delete after 90 days" },
  { value: "180", label: "Delete after 180 days" },
  { value: "365", label: "Delete after 1 year" },
];

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card rounded-xl border p-5 shadow-xs sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <span className="bg-accent text-accent-foreground grid size-9 shrink-0 place-items-center rounded-lg">
          <Icon className="size-4" />
        </span>
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export function FormSettingsPanel({
  formId,
  appUrl,
  initial,
  ownerEmail,
  emailConfigured,
}: {
  formId: string;
  appUrl: string;
  initial: FormSettings & { notificationsEnabled: boolean };
  ownerEmail: string;
  emailConfigured: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [savePartial, setSavePartial] = useState(initial.savePartialResponses);
  const [retention, setRetention] = useState<number | null>(initial.partialRetentionDays);
  const [notify, setNotify] = useState(initial.notificationsEnabled);
  const [slug, setSlug] = useState(initial.slug);
  const [savedSlug, setSavedSlug] = useState(initial.slug);

  function saveUnfinished(next: {
    savePartialResponses: boolean;
    partialRetentionDays: number | null;
  }) {
    const previous = { savePartial, retention };
    setSavePartial(next.savePartialResponses);
    setRetention(next.partialRetentionDays);
    startTransition(async () => {
      const result = await updateUnfinishedSettingsAction(formId, next);
      if (result.ok) {
        toast.success("Saved");
      } else {
        setSavePartial(previous.savePartial);
        setRetention(previous.retention);
        toast.error(result.message);
      }
    });
  }

  function saveNotify(enabled: boolean) {
    setNotify(enabled);
    startTransition(async () => {
      const result = await setNotificationsAction(formId, enabled);
      if (result.ok) toast.success(enabled ? "Notifications on" : "Notifications off");
      else {
        setNotify(!enabled);
        toast.error(result.message);
      }
    });
  }

  function saveSlug() {
    startTransition(async () => {
      const result = await updateSlugAction(formId, slug);
      if (result.ok && result.slug) {
        setSlug(result.slug);
        setSavedSlug(result.slug);
        toast.success("Link updated", {
          description: "The old link no longer works — update anywhere you shared it.",
        });
        router.refresh();
      } else if (!result.ok) {
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <Section
        icon={ShieldCheck}
        title="Unfinished responses"
        description="Answers from people who start but don't submit — including lead contact details."
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="save-partial" className="font-medium">
              Save answers as people go
            </Label>
            <p className="text-muted-foreground mt-1 text-sm">
              {savePartial
                ? "On — you'll see incomplete responses and capture leads who don't finish. Respondents are told their answers are saved as they go."
                : "Off — nothing is stored until someone submits. Use this for sensitive forms; incomplete responses and drop-off won't be available."}
            </p>
          </div>
          <Switch
            id="save-partial"
            checked={savePartial}
            disabled={pending}
            onCheckedChange={(checked) =>
              saveUnfinished({
                savePartialResponses: checked,
                partialRetentionDays: retention,
              })
            }
          />
        </div>
        <div className="mt-5 grid gap-1.5 sm:max-w-xs">
          <Label htmlFor="retention">Automatically delete unfinished responses</Label>
          <Select
            value={retention === null ? "keep" : String(retention)}
            disabled={pending}
            onValueChange={(value) =>
              saveUnfinished({
                savePartialResponses: savePartial,
                partialRetentionDays: value === "keep" ? null : Number(value),
              })
            }
          >
            <SelectTrigger id="retention" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RETENTION_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            Counted from their last activity. Completed responses are never deleted
            automatically.
          </p>
        </div>
      </Section>

      <Section
        icon={Bell}
        title="Notifications"
        description="Get an email when someone completes this form."
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="notify" className="font-medium">
              Email me about new responses
            </Label>
            <p className="text-muted-foreground mt-1 text-sm">
              Sent to {ownerEmail || "the form owner"}, with a link to the response —
              answers aren&apos;t included in the email.
            </p>
            {!emailConfigured && (
              <p className="mt-2 text-sm text-amber-700">
                Email sending isn&apos;t set up on this server yet (RESEND_API_KEY), so no
                emails go out until it is.
              </p>
            )}
          </div>
          <Switch
            id="notify"
            checked={notify}
            disabled={pending}
            onCheckedChange={saveNotify}
          />
        </div>
      </Section>

      <Section
        icon={Link2}
        title="Public link"
        description="The address people use to open this form."
      >
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            saveSlug();
          }}
        >
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="slug">Link</Label>
            <div className="border-input flex items-center overflow-hidden rounded-md border">
              <span className="text-muted-foreground bg-muted/60 hidden shrink-0 border-r px-3 py-1.5 text-sm sm:block">
                {(appUrl || "").replace(/^https?:\/\//, "")}/f/
              </span>
              <Input
                id="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                className="rounded-none border-0 shadow-none focus-visible:ring-0"
                spellCheck={false}
              />
            </div>
          </div>
          <Button type="submit" disabled={pending || slug.trim() === savedSlug}>
            Save link
          </Button>
        </form>
        <p className="text-muted-foreground mt-2 text-xs">
          Changing it breaks the old link, including existing embeds.
        </p>
      </Section>
    </div>
  );
}
