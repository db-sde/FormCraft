import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { removeUploadFiles } from "@/domains/uploads/cleanup";

type Client = SupabaseClient<Database>;

const BATCH = 500;

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

      await removeUploadFiles(admin, { responseIds: ids });

      const { error: deleteError } = await admin.from("responses").delete().in("id", ids);
      if (deleteError) throw deleteError;
      deleted += ids.length;
      if (ids.length < BATCH) break;
    }
  }
  return { deleted };
}

const DELETED_FORM_GRACE_DAYS = 30;

/**
 * Permanently removes forms that were deleted more than 30 days ago —
 * their responses, leads, analytics and uploaded files — which
 * otherwise sat in the database forever after a creator "deleted" them.
 * The grace period leaves room to restore one by hand. Run from the
 * retention cron.
 */
export async function purgeDeletedForms(
  admin: Client,
  now: Date = new Date(),
): Promise<{ purged: number }> {
  const cutoff = new Date(
    now.getTime() - DELETED_FORM_GRACE_DAYS * 86_400_000,
  ).toISOString();
  let purged = 0;
  for (;;) {
    const { data: forms, error } = await admin
      .from("forms")
      .select("id")
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoff)
      .limit(100);
    if (error) throw error;
    if (!forms?.length) break;
    const formIds = forms.map((f) => f.id);

    await removeUploadFiles(admin, { formIds });
    const { error: deleteError } = await admin.from("forms").delete().in("id", formIds);
    if (deleteError) throw deleteError;
    purged += formIds.length;
    if (forms.length < 100) break;
  }
  return { purged };
}
