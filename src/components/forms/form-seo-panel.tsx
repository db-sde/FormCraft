"use client";

import { useState, useTransition } from "react";
import { toast } from "@/lib/toast";
import { saveSeoAction } from "@/app/(form)/forms/[id]/(sections)/settings/actions";
import { SettingsSection } from "@/components/dashboard/account-settings";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { notOnPlanMessage } from "@/domains/billing/entitlements";
import type { FormSeo } from "@/domains/forms/seo";
import { ShareImageCropper } from "./share-image-cropper";

const hasMergeTag = (v: string) => /\{\{|\}\}/.test(v);

/** "45 / 70", shown once the text is near its limit. */
function Counter({ value, warnAt, max }: { value: string; warnAt: number; max: number }) {
  if (value.length < warnAt) return null;
  return (
    <span
      className={
        value.length > max ? "text-destructive text-xs" : "text-muted-foreground text-xs"
      }
    >
      {value.length} / {max}
    </span>
  );
}

/** How the link looks where it's shared. */
function PreviewCards({
  title,
  description,
  image,
  host,
}: {
  title: string;
  description: string;
  image: string | undefined;
  host: string;
}) {
  const img = (h: string) =>
    image ? (
      // eslint-disable-next-line @next/next/no-img-element -- a preview of the share image
      <img src={image} alt="" className={`w-full object-cover ${h}`} />
    ) : (
      <div
        className={`bg-muted text-muted-foreground grid place-items-center text-xs ${h}`}
      >
        Card made when you publish
      </div>
    );
  return (
    <div className="grid gap-3 sm:col-span-2 lg:grid-cols-3">
      <figure className="flex flex-col gap-1">
        <figcaption className="text-muted-foreground text-xs font-semibold">
          WhatsApp
        </figcaption>
        <div className="overflow-hidden rounded-lg bg-[#d9fdd3] p-1.5 text-[#111b21]">
          <div className="overflow-hidden rounded-md bg-[#c4ecbe]">
            {img("aspect-[1200/630]")}
            <div className="px-2.5 py-2">
              <div className="truncate text-[13px] font-semibold">{title}</div>
              <div className="line-clamp-2 text-xs opacity-75">{description}</div>
              <div className="text-xs opacity-60">{host}</div>
            </div>
          </div>
        </div>
      </figure>
      <figure className="flex flex-col gap-1">
        <figcaption className="text-muted-foreground text-xs font-semibold">
          LinkedIn
        </figcaption>
        <div className="overflow-hidden rounded-lg border border-[#e0dfdc] bg-white text-[#191919]">
          {img("aspect-[1200/630]")}
          <div className="bg-[#eef3f8] px-3 py-2">
            <div className="line-clamp-2 text-[13px] font-semibold">{title}</div>
            <div className="text-xs text-[#666]">{host}</div>
          </div>
        </div>
      </figure>
      <figure className="flex flex-col gap-1">
        <figcaption className="text-muted-foreground text-xs font-semibold">X</figcaption>
        <div className="relative overflow-hidden rounded-2xl border border-[#cfd9de] bg-white text-[#0f1419]">
          {img("aspect-[1200/630]")}
          <span className="absolute bottom-2 left-2 max-w-[85%] truncate rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
            {title}
          </span>
        </div>
        <span className="text-muted-foreground text-xs">From {host}</span>
      </figure>
    </div>
  );
}

/**
 * Settings → Sharing & SEO (developer spec item 1; Starter and up): what
 * a shared link shows, the tab icon, and search indexing (off unless
 * turned on). Saved with the form; live when it's published. On Free the
 * automatic preview is used: the form's title and a card with the
 * FormCraft badge.
 */
export function FormSeoPanel({
  formId,
  formTitle,
  defaultDescription,
  host,
  initial,
  allowed,
  canManage,
}: {
  formId: string;
  formTitle: string;
  /** The welcome screen's first line, used when no description is set. */
  defaultDescription: string;
  host: string;
  initial: FormSeo;
  allowed: boolean;
  canManage: boolean;
}) {
  const [title, setTitle] = useState(initial.title ?? "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [imageUrl, setImageUrl] = useState(initial.imageUrl);
  const [faviconUrl, setFaviconUrl] = useState(initial.faviconUrl);
  const [indexing, setIndexing] = useState(initial.indexing === true);
  const [saving, start] = useTransition();
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const disabled = !canManage || !allowed;
  const mergeTag = hasMergeTag(title) || hasMergeTag(description);

  function save() {
    start(async () => {
      const result = await saveSeoAction(formId, {
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        imageUrl,
        faviconUrl,
        indexing,
      });
      if (result.ok)
        toast.success("Saved.", {
          description: "It goes live the next time you publish.",
        });
      else toast.error("Couldn't save that.", { description: result.message });
    });
  }

  async function uploadIcon(file: File | undefined) {
    if (!file) return;
    if (file.size > 512 * 1024) {
      toast.error("Use an icon up to 512 KB.");
      return;
    }
    setUploadingIcon(true);
    const body = new FormData();
    body.set("file", file);
    body.set("kind", "favicon");
    try {
      const res = await fetch(`/api/forms/${formId}/seo-asset`, { method: "POST", body });
      const json = (await res.json()) as { url?: string; message?: string };
      if (!res.ok || !json.url)
        throw new Error(json.message ?? "Couldn't use that icon.");
      setFaviconUrl(json.url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't use that icon.");
    } finally {
      setUploadingIcon(false);
    }
  }

  return (
    <SettingsSection
      title="Sharing & SEO"
      description="What people see when the form's link is shared on WhatsApp, LinkedIn, X, Slack or iMessage, and whether search engines list it. Changes go live when you publish."
    >
      {!allowed && (
        <p className="text-muted-foreground text-sm">
          {notOnPlanMessage("custom_seo")} Shared links use the form&apos;s title (
          {formTitle || "Untitled"}) and a card made when you publish, and search engines
          don&apos;t list the form.
        </p>
      )}
      <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="seo-title">Share title</Label>
            <Counter value={title} warnAt={60} max={70} />
          </div>
          <Input
            id="seo-title"
            maxLength={70}
            placeholder={formTitle}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="seo-description">Share description</Label>
            <Counter value={description} warnAt={155} max={200} />
          </div>
          <Input
            id="seo-description"
            maxLength={200}
            placeholder={defaultDescription}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {mergeTag && (
          <p role="alert" className="text-destructive text-sm sm:col-span-2">
            Share fields can&apos;t use {"{{merge tags}}"}: every shared link shows the
            same text.
          </p>
        )}
        {!disabled && (
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-sm font-semibold">Share image</span>
            <ShareImageCropper formId={formId} onUploaded={setImageUrl} />
            {imageUrl && (
              <button
                type="button"
                className="text-muted-foreground self-start text-xs underline"
                onClick={() => setImageUrl(undefined)}
              >
                Use the automatic card instead
              </button>
            )}
          </div>
        )}
        {!disabled && (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">
              Tab icon (PNG or ICO, up to 512 KB)
            </span>
            <div className="flex items-center gap-2">
              {faviconUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- the chosen icon
                <img src={faviconUrl} alt="Tab icon" className="size-6 rounded-xs" />
              )}
              <label className="border-input hover:bg-muted flex h-[34px] cursor-pointer items-center rounded-sm border-[1.5px] px-3 text-sm">
                {uploadingIcon ? "Uploading…" : faviconUrl ? "Change" : "Choose"}
                <input
                  type="file"
                  accept="image/png,image/x-icon,.ico"
                  className="sr-only"
                  onChange={(e) => uploadIcon(e.target.files?.[0])}
                />
              </label>
              {faviconUrl && (
                <button
                  type="button"
                  className="text-muted-foreground text-xs underline"
                  onClick={() => setFaviconUrl(undefined)}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        )}
        <div className="flex items-center gap-2.5 sm:col-span-2">
          <Switch id="seo-indexing" checked={indexing} onCheckedChange={setIndexing} />
          <Label htmlFor="seo-indexing">Let search engines show this form</Label>
        </div>
        <PreviewCards
          title={title.trim() || formTitle || "Untitled form"}
          description={description.trim() || defaultDescription}
          image={imageUrl}
          host={host}
        />
      </fieldset>
      <p className="text-muted-foreground text-xs">
        Apps keep previews for a while. After publishing a change, refresh them with the{" "}
        <a
          className="underline"
          href="https://developers.facebook.com/tools/debug/"
          target="_blank"
          rel="noreferrer"
        >
          Facebook Sharing Debugger
        </a>{" "}
        (WhatsApp uses it too) and the{" "}
        <a
          className="underline"
          href="https://www.linkedin.com/post-inspector/"
          target="_blank"
          rel="noreferrer"
        >
          LinkedIn Post Inspector
        </a>
        . Password-protected, closed and archived forms are never listed by search
        engines.
      </p>
      {!disabled && (
        <Button onClick={save} disabled={saving || mergeTag} className="self-start">
          {saving && <ButtonSpinner />} Save sharing settings
        </Button>
      )}
    </SettingsSection>
  );
}
