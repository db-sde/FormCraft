import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

export const SHARE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const FAVICON_MAX_BYTES = 512 * 1024;
export const SHARE_WIDTH = 1200;
export const SHARE_HEIGHT = 630;

export class ShareAssetError extends Error {}

/** The crop the creator chose, in the original image's pixels. */
export type Crop = { x: number; y: number; width: number; height: number };

/** Writes a processed file to the public share-assets bucket under a
 * content-hashed name with a year's cache, and returns its URL. Writing
 * the same bytes twice is harmless. */
async function store(
  admin: Client,
  folder: string,
  bytes: Buffer,
  ext: "jpg" | "png" | "ico",
  contentType: string,
): Promise<string> {
  const name = `${folder}/${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}.${ext}`;
  const { error } = await admin.storage.from("share-assets").upload(name, bytes, {
    contentType,
    cacheControl: "31536000",
    upsert: true,
  });
  if (error) throw error;
  return admin.storage.from("share-assets").getPublicUrl(name).data.publicUrl;
}

/**
 * A share image (developer spec item 1): JPG, PNG or WebP up to 5 MB,
 * cropped where the creator chose, resized to 1200 × 630 and re-encoded
 * as JPEG on the server. Re-encoding drops EXIF and location data.
 */
export async function processShareImage(
  admin: Client,
  folder: string,
  input: Buffer,
  crop: Crop | null,
): Promise<string> {
  if (input.length > SHARE_IMAGE_MAX_BYTES) {
    throw new ShareAssetError("Use an image up to 5 MB.");
  }
  const sharp = (await import("sharp")).default;
  let image = sharp(input, { failOn: "error", limitInputPixels: 50_000_000 });
  const meta = await image.metadata().catch(() => null);
  if (!meta || !["jpeg", "png", "webp"].includes(meta.format ?? "")) {
    throw new ShareAssetError("Use a JPG, PNG or WebP image.");
  }
  // Turn it the way the camera meant, then forget the camera.
  image = image.rotate();
  if (crop) {
    const oriented = await image.clone().toBuffer({ resolveWithObject: true });
    const w = oriented.info.width;
    const h = oriented.info.height;
    const left = Math.max(0, Math.min(Math.round(crop.x), w - 1));
    const top = Math.max(0, Math.min(Math.round(crop.y), h - 1));
    const width = Math.max(1, Math.min(Math.round(crop.width), w - left));
    const height = Math.max(1, Math.min(Math.round(crop.height), h - top));
    image = sharp(oriented.data).extract({ left, top, width, height });
  }
  const out = await image
    .resize(SHARE_WIDTH, SHARE_HEIGHT, { fit: "cover", position: "centre" })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
  return store(admin, folder, out, "jpg", "image/jpeg");
}

/** A tab icon: PNG (resized to 64 × 64, re-encoded) or ICO, up to 512 KB. */
export async function processFavicon(
  admin: Client,
  folder: string,
  input: Buffer,
): Promise<string> {
  if (input.length > FAVICON_MAX_BYTES) {
    throw new ShareAssetError("Use an icon up to 512 KB.");
  }
  const isIco =
    input.length > 4 &&
    input[0] === 0 &&
    input[1] === 0 &&
    input[2] === 1 &&
    input[3] === 0;
  if (isIco) return store(admin, folder, input, "ico", "image/x-icon");
  const sharp = (await import("sharp")).default;
  const meta = await sharp(input)
    .metadata()
    .catch(() => null);
  if (meta?.format !== "png") throw new ShareAssetError("Use a PNG or ICO icon.");
  const out = await sharp(input)
    .resize(64, 64, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return store(admin, folder, out, "png", "image/png");
}

/** Stores a share card made at publish time (share-card.tsx). */
export function storeShareCard(
  admin: Client,
  folder: string,
  png: Buffer,
): Promise<string> {
  return store(admin, folder, png, "png", "image/png");
}
