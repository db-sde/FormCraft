"use client";

import { useEffect, useRef, useState } from "react";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/lib/toast";

const RATIO = 630 / 1200;

/**
 * Picks a share image and crops it to 1200 × 630 (developer spec item
 * 1): drag to move it, slide to zoom. The server crops, resizes and
 * re-encodes it, dropping EXIF and location data.
 */
export function ShareImageCropper({
  formId,
  onUploaded,
}: {
  formId: string;
  onUploaded: (url: string) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [uploading, setUploading] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const [frameW, setFrameW] = useState(480);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setFrameW(el.clientWidth || 480));
    observer.observe(el);
    return () => observer.disconnect();
  }, [src]);
  const frameH = frameW * RATIO;
  const scale = natural ? Math.max(frameW / natural.w, frameH / natural.h) * zoom : 1;

  function clamp(x: number, y: number) {
    if (!natural) return { x: 0, y: 0 };
    const w = natural.w * scale;
    const h = natural.h * scale;
    return {
      x: Math.min(0, Math.max(frameW - w, x)),
      y: Math.min(0, Math.max(frameH - h, y)),
    };
  }

  function choose(f: File | undefined) {
    if (!f) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) {
      toast.error("Use a JPG, PNG or WebP image.");
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      toast.error("Use an image up to 5 MB.");
      return;
    }
    setFile(f);
    setSrc(URL.createObjectURL(f));
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }

  async function upload() {
    if (!file || !natural) return;
    setUploading(true);
    const crop = {
      x: -offset.x / scale,
      y: -offset.y / scale,
      width: frameW / scale,
      height: frameH / scale,
    };
    const body = new FormData();
    body.set("file", file);
    body.set("kind", "image");
    body.set("crop", JSON.stringify(crop));
    try {
      const res = await fetch(`/api/forms/${formId}/seo-asset`, { method: "POST", body });
      const json = (await res.json()) as { url?: string; message?: string };
      if (!res.ok || !json.url)
        throw new Error(json.message ?? "Couldn't use that image.");
      onUploaded(json.url);
      setSrc(null);
      setFile(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't use that image.");
    } finally {
      setUploading(false);
    }
  }

  if (!src) {
    return (
      <label className="border-input hover:bg-muted flex h-[38px] cursor-pointer items-center justify-center rounded-sm border-[1.5px] border-dashed px-3 text-sm font-semibold">
        Choose a share image (JPG, PNG or WebP, up to 5 MB)
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(e) => choose(e.target.files?.[0])}
        />
      </label>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={frame}
        className="border-ink relative w-full touch-none overflow-hidden rounded-sm border-[1.5px] bg-black/5 select-none"
        style={{ aspectRatio: "1200 / 630", cursor: "grab" }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setOffset(
            clamp(
              drag.current.ox + e.clientX - drag.current.x,
              drag.current.oy + e.clientY - drag.current.y,
            ),
          );
        }}
        onPointerUp={() => (drag.current = null)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the chosen file */}
        <img
          src={src}
          alt="Share image being cropped"
          draggable={false}
          onLoad={(e) => {
            setNatural({
              w: e.currentTarget.naturalWidth,
              h: e.currentTarget.naturalHeight,
            });
          }}
          className="pointer-events-none absolute top-0 left-0 max-w-none"
          style={
            natural
              ? {
                  width: natural.w * scale,
                  height: natural.h * scale,
                  transform: `translate(${offset.x}px, ${offset.y}px)`,
                }
              : { opacity: 0 }
          }
        />
      </div>
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground text-xs">Zoom</span>
        <Slider
          aria-label="Zoom"
          min={1}
          max={3}
          step={0.01}
          value={[zoom]}
          onValueChange={([z]) => {
            setZoom(z);
            setOffset((o) => clamp(o.x, o.y));
          }}
          className="flex-1"
        />
      </div>
      <div className="flex gap-2">
        <Button type="button" disabled={uploading || !natural} onClick={upload}>
          {uploading && <ButtonSpinner />} Use this crop
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setSrc(null);
            setFile(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
