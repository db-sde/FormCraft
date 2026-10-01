"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast";
import {
  updateSlugAction,
  updateUnfinishedSettingsAction,
} from "@/app/(form)/forms/[id]/(sections)/settings/actions";
import type { FormSettings } from "@/domains/forms";
import { SettingsSection } from "@/components/dashboard/account-settings";
import { Button, ButtonSpinner } from "@/components/ui/button";
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

/** A form's own settings: unfinished responses and its public link.
 * (Email notifications live on the Integrations page.) */
export function FormSettingsPanel({
  formId,
  appUrl,
  initial,
}: {
  formId: string;
  appUrl: string;
  initial: FormSettings;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [savingSlug, startSavingSlug] = useTransition();
  const [savePartial, setSavePartial] = useState(initial.savePartialResponses);
  const [retention, setRetention] = useState<number | null>(initial.partialRetentionDays);
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
        toast.success("Saved.");
      } else {
        setSavePartial(previous.savePartial);
        setRetention(previous.retention);
        toast.error("Couldn't save that.", { description: result.message });
      }
    });
  }

  function saveSlug() {
    startSavingSlug(async () => {
      const result = await updateSlugAction(formId, slug);
      if (result.ok && result.slug) {
        setSlug(result.slug);
        setSavedSlug(result.slug);
        toast.success("Link updated.", {
          description: "The old link no longer works. Update anywhere you shared it.",
        });
        router.refresh();
      } else if (!result.ok) {
        toast.error("Couldn't change the link.", { description: result.message });
      }
    });
  }

  return (
    <div className="flex flex-col gap-[26px]">
      <SettingsSection
        title="Unfinished responses"
        description="Answers from people who start but don't submit, including lead contact details."
      >
        <div className="flex flex-col gap-5">
          <label className="bg-background flex cursor-pointer items-start justify-between gap-4 rounded-sm px-3 py-2.5">
            <span className="flex flex-col gap-0.5">
              <b className="text-sm">Save answers as people go</b>
              <span className="text-muted-foreground text-[12.5px] leading-normal">
                {savePartial
                  ? "On: you'll see unfinished responses and capture leads who don't finish. Respondents are told their answers are saved as they go."
                  : "Off: nothing is stored until someone submits. Use this for sensitive forms; unfinished responses and drop-off won't be available."}
              </span>
            </span>
            <Switch
              checked={savePartial}
              disabled={pending}
              onCheckedChange={(checked) =>
                saveUnfinished({
                  savePartialResponses: checked,
                  partialRetentionDays: retention,
                })
              }
            />
          </label>
          <div className="grid gap-1.5 sm:max-w-xs">
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
        </div>
      </SettingsSection>

      <SettingsSection
        title="Public link"
        description="The address people use to open this form."
        last
      >
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            saveSlug();
          }}
        >
          <Label htmlFor="slug">Link</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="border-input bg-field focus-within:shadow-focus flex h-[42px] min-w-0 flex-1 items-center overflow-hidden rounded-sm border-[1.5px]">
              <span className="text-muted-foreground bg-background border-input hidden h-full shrink-0 items-center border-r-[1.5px] px-3 font-mono text-[13px] sm:flex">
                {(appUrl || "").replace(/^https?:\/\//, "")}/f/
              </span>
              <input
                id="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                spellCheck={false}
                className="h-full min-w-0 flex-1 bg-transparent px-3 font-mono text-[13.5px] outline-none"
              />
            </div>
            <Button
              type="submit"
              className="h-[42px]"
              data-loading={savingSlug || undefined}
              disabled={savingSlug || slug.trim() === savedSlug}
            >
              {savingSlug && <ButtonSpinner />}
              Save link
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Changing it breaks the old link, including existing embeds.
          </p>
        </form>
      </SettingsSection>
    </div>
  );
}
