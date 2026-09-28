"use client";

import { useState } from "react";
import { Upload, X, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export function ImageUploadField({
  label,
  workspaceId,
  formId,
  value,
  onChange,
}: {
  label: string;
  workspaceId: string;
  formId: string;
  value: string | undefined;
  onChange: (url: string | undefined) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);

    // Client-side checks are UX only — nothing here is the security
    // boundary. The bucket is public-read but write access is scoped
    // by RLS to members of `workspaceId` (see storage_buckets
    // migration), and actual content-type sniffing for anything
    // privacy-sensitive happens server-side for respondent uploads;
    // this bucket only ever holds creator-supplied theme assets.
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Use a PNG, JPEG, WebP, or SVG image.");
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError("Image must be under 5MB.");
      return;
    }

    setUploading(true);
    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop() ?? "png";
      const path = `${workspaceId}/${formId}/${label.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("theme-assets")
        .upload(path, file, { upsert: true });

      if (uploadError) {
        setError("Upload failed. Please try again.");
        return;
      }

      const { data } = supabase.storage.from("theme-assets").getPublicUrl(path);
      onChange(data.publicUrl);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground text-xs font-medium">{label}</Label>
      {value ? (
        <div className="border-input relative overflow-hidden rounded-md border">
          {/* eslint-disable-next-line @next/next/no-img-element -- external, variable-origin Supabase Storage URL */}
          <img src={value} alt="" className="h-24 w-full object-cover" />
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className="absolute top-1.5 right-1.5"
            aria-label={`Remove ${label.toLowerCase()}`}
            onClick={() => onChange(undefined)}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ) : (
        <label className="border-input hover:bg-accent/50 flex h-20 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed text-sm">
          {uploading ? (
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
          ) : (
            <Upload className="text-muted-foreground size-4" />
          )}
          <span className="text-muted-foreground">
            {uploading ? "Uploading…" : "Upload image"}
          </span>
          <input
            type="file"
            accept={ACCEPTED_TYPES.join(",")}
            className="sr-only"
            disabled={uploading}
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
        </label>
      )}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}
