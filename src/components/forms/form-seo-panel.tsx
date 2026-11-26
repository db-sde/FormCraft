"use client";

import { useState, useTransition } from "react";
import { toast } from "@/lib/toast";
import { saveSeoAction } from "@/app/(form)/forms/[id]/(sections)/settings/actions";
import { SettingsSection } from "@/components/dashboard/account-settings";
import { ImageUploadField } from "@/components/builder/image-upload-field";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { notOnPlanMessage } from "@/domains/billing/entitlements";
import type { FormSeo } from "@/domains/forms/seo";

/**
 * Link preview and SEO (pricing doc, Starter and up): what a shared link
 * shows, the tab icon, and search indexing. On Free the form's own title
 * and description make the preview.
 */
export function FormSeoPanel({
  formId,
  workspaceId,
  formTitle,
  initial,
  allowed,
  canManage,
}: {
  formId: string;
  workspaceId: string;
  formTitle: string;
  initial: FormSeo;
  allowed: boolean;
  canManage: boolean;
}) {
  const [title, setTitle] = useState(initial.title ?? "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [imageUrl, setImageUrl] = useState(initial.imageUrl);
  const [faviconUrl, setFaviconUrl] = useState(initial.faviconUrl);
  const [indexing, setIndexing] = useState(initial.indexing !== false);
  const [saving, start] = useTransition();
  const disabled = !canManage || !allowed;

  function save() {
    start(async () => {
      const result = await saveSeoAction(formId, {
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        imageUrl,
        faviconUrl,
        indexing,
      });
      if (result.ok) toast.success("Link preview saved.");
      else toast.error("Couldn't save that.", { description: result.message });
    });
  }

  return (
    <SettingsSection
      title="Link preview and search"
      description="What people see when the form's link is shared, and whether search engines list it."
    >
      {!allowed && (
        <p className="text-muted-foreground text-sm">
          {notOnPlanMessage("custom_seo")} Shared links use the form&apos;s title (
          {formTitle || "Untitled"}) and description.
        </p>
      )}
      <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="seo-title">Share title</Label>
          <Input
            id="seo-title"
            maxLength={70}
            placeholder={formTitle}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="seo-description">Share description</Label>
          <Input
            id="seo-description"
            maxLength={200}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {!disabled && (
          <>
            <ImageUploadField
              label="Share image (1200 × 630 works best)"
              noun="an image"
              workspaceId={workspaceId}
              formId={formId}
              value={imageUrl}
              onChange={setImageUrl}
            />
            <ImageUploadField
              label="Tab icon (square)"
              noun="an icon"
              workspaceId={workspaceId}
              formId={formId}
              value={faviconUrl}
              onChange={setFaviconUrl}
            />
          </>
        )}
        <div className="flex items-center gap-2.5 sm:col-span-2">
          <Switch id="seo-indexing" checked={indexing} onCheckedChange={setIndexing} />
          <Label htmlFor="seo-indexing">Let search engines list this form</Label>
        </div>
      </fieldset>
      {!disabled && (
        <Button onClick={save} disabled={saving} className="self-start">
          {saving && <ButtonSpinner />} Save link preview
        </Button>
      )}
    </SettingsSection>
  );
}
