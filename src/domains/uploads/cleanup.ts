import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

export const UPLOADS_BUCKET = "response-uploads";
export const THEME_ASSETS_BUCKET = "theme-assets";

/** Rows per database page. Kept below PostgREST's max_rows (1000): a
 * larger request is silently truncated, which is how cleanup used to
 * strand files once an account had more than 1000 uploads. */
const PAGE = 500;
/** Paths per storage delete call. */
const REMOVE_CHUNK = 100;

async function removeFromBucket(admin: Client, bucket: string, paths: string[]) {
  for (let i = 0; i < paths.length; i += REMOVE_CHUNK) {
    const { error } = await admin.storage
      .from(bucket)
      .remove(paths.slice(i, i + REMOVE_CHUNK));
    if (error) throw error;
  }
}

/**
 * Deletes the stored files of every upload belonging to the given
 * responses and/or forms, however many there are (keyset-paged by id).
 * The database rows are NOT touched — callers delete responses/forms
 * afterwards and the cascade removes the rows; storage objects are the
 * part a cascade can't reach. Returns how many files were removed.
 */
export async function removeUploadFiles(
  admin: Client,
  scope: { responseIds?: string[]; formIds?: string[] },
): Promise<number> {
  const responseIds = scope.responseIds ?? [];
  const formIds = scope.formIds ?? [];
  if (responseIds.length === 0 && formIds.length === 0) return 0;

  let removed = 0;
  // `.in()` lists go in the URL, so scope them in slices as well.
  const slices: { responseIds?: string[]; formIds?: string[] }[] = [];
  for (let i = 0; i < responseIds.length; i += 100) {
    slices.push({ responseIds: responseIds.slice(i, i + 100) });
  }
  for (let i = 0; i < formIds.length; i += 100) {
    slices.push({ formIds: formIds.slice(i, i + 100) });
  }

  for (const slice of slices) {
    let cursor: string | null = null;
    for (;;) {
      let query = admin
        .from("uploads")
        .select("id, storage_path, responses!inner(form_id)")
        .order("id")
        .limit(PAGE);
      if (slice.responseIds) query = query.in("response_id", slice.responseIds);
      if (slice.formIds) query = query.in("responses.form_id", slice.formIds);
      if (cursor) query = query.gt("id", cursor);

      const { data, error } = await query;
      if (error) throw error;
      if (!data?.length) break;

      await removeFromBucket(
        admin,
        UPLOADS_BUCKET,
        data.map((row) => row.storage_path),
      );
      removed += data.length;
      cursor = data[data.length - 1].id;
      if (data.length < PAGE) break;
    }
  }
  return removed;
}

/** Deletes every object under `prefix/` in a bucket, including nested
 * folders — used for a workspace's theme assets (logos, backgrounds). */
export async function removeFolder(
  admin: Client,
  bucket: string,
  prefix: string,
): Promise<number> {
  let removed = 0;
  for (;;) {
    // Always list from the start: each pass deletes what it lists.
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 100 });
    if (error) throw error;
    if (!data?.length) break;

    const files = data
      .filter((entry) => entry.id !== null)
      .map((e) => `${prefix}/${e.name}`);
    const folders = data
      .filter((entry) => entry.id === null)
      .map((e) => `${prefix}/${e.name}`);
    if (files.length) {
      await removeFromBucket(admin, bucket, files);
      removed += files.length;
    }
    for (const folder of folders) removed += await removeFolder(admin, bucket, folder);
    if (!files.length && !folders.length) break;
    // Empty folders vanish with their last object; if only folders were
    // listed and they're now empty, the next list comes back empty.
  }
  return removed;
}
