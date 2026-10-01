"use client";

import { useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

/** The file name at the end of a storage URL, without our upload prefix. */
function fileNameFrom(url: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    return last || "image";
  } catch {
    return "image";
  }
}

/** Creator image upload (Part 4): a dashed "Upload …" button when empty,
 * a thumbnail row with a remove button when set. */
export function ImageUploadField({
  label,
  noun = "an image",
  meta,
  workspaceId,
  formId,
  value,
  onChange,
}: {
  label: string;
  /** "a logo", "an image" — reads "Upload a logo". */
  noun?: string;
  /** Second line of the filled row, e.g. "Top left, 32px tall". */
  meta?: string;
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
      setError("Use a PNG, JPEG, WebP or SVG image.");
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError("That image is over 5 MB. Try a smaller one.");
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
        setError("The upload failed. Try again.");
        return;
      }

      const { data } = supabase.storage.from("theme-assets").getPublicUrl(path);
      onChange(data.publicUrl);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="col-span-full flex flex-col gap-1.5">
      <span className="text-[13.5px] font-semibold">{label}</span>
      {value ? (
        <div className="border-ink flex items-center gap-2.5 rounded-[8px] border-[1.5px] p-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- external, variable-origin Supabase Storage URL */}
          <img
            src={value}
            alt=""
            className="bg-muted h-10 w-14 shrink-0 rounded-[5px] object-cover"
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="truncate text-[13px]">{fileNameFrom(value)}</b>
            {meta && <span className="text-muted-foreground text-xs">{meta}</span>}
          </span>
          <button
            type="button"
            aria-label={`Remove ${label.toLowerCase()}`}
            onClick={() => onChange(undefined)}
            className="fc-focus hover:bg-hover-wash grid size-7 shrink-0 place-items-center rounded-sm"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ) : (
        <label className="border-ink hover:bg-hover-wash focus-within:shadow-focus flex cursor-pointer items-center gap-3 rounded-[8px] border-[1.5px] border-dashed p-3">
          {uploading ? (
            <span className="border-ink size-5 shrink-0 animate-spin rounded-full border-2 border-t-transparent" />
          ) : (
            <ImagePlus className="size-5 shrink-0" />
          )}
          <span className="flex flex-col">
            <b className="text-[13.5px]">{uploading ? "Uploading…" : `Upload ${noun}`}</b>
            <span className="text-muted-foreground text-xs">
              PNG, JPEG, WebP or SVG · up to 5 MB
            </span>
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
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
