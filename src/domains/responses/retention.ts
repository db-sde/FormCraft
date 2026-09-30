import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

const BATCH = 500;
const UPLOADS_BUCKET = "response-uploads";

/**
 * Deletes unfinished responses older than each form's retention setting
 * (forms.partial_retention_days), including their uploaded files —
 * storage objects aren't removed by the database cascade, so they're
 * deleted explicitly first. Completed responses are never touched.
 * Run from the retention cron with the service-role client.
 */
export async function purgeExpiredUnfinishedResponses(
  admin: Client,
  now: Date = new Date(),
): Promise<{ deleted: number }> {
  const { data: forms, error } = await admin
    .from("forms")
    .select("id, partial_retention_days")
    .not("partial_retention_days", "is", null);
  if (error) throw error;

  let deleted = 0;
  for (const form of forms ?? []) {
    const cutoff = new Date(
      now.getTime() - (form.partial_retention_days ?? 0) * 86_400_000,
    ).toISOString();

    for (;;) {
      const { data: expired, error: expiredError } = await admin
        .from("responses")
        .select("id")
        .eq("form_id", form.id)
        .in("status", ["in_progress", "partial"])
        .lt("last_active_at", cutoff)
        .limit(BATCH);
      if (expiredError) throw expiredError;
      if (!expired?.length) break;
      const ids = expired.map((r) => r.id);

      const { data: uploads, error: uploadsError } = await admin
        .from("uploads")
        .select("storage_path")
        .in("response_id", ids);
      if (uploadsError) throw uploadsError;
      if (uploads?.length) {
        const { error: removeError } = await admin.storage
          .from(UPLOADS_BUCKET)
          .remove(uploads.map((u) => u.storage_path));
        if (removeError) throw removeError;
      }

      const { error: deleteError } = await admin.from("responses").delete().in("id", ids);
      if (deleteError) throw deleteError;
      deleted += ids.length;
      if (ids.length < BATCH) break;
    }
  }
  return { deleted };
}
