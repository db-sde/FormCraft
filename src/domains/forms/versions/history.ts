import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/**
 * Version history (PRD P3.10). Published versions are immutable and each
 * response points at the one it was served; restoring copies an old
 * version's schema into the draft — a new edit, published like any other
 * — and never touches existing versions or responses.
 */

export type VersionSummary = {
  id: string;
  versionNumber: number;
  status: "published" | "archived";
  publishedAt: string | null;
  publishedBy: string | null;
  responseCount: number;
};

export async function listVersions(
  supabase: Client,
  formId: string,
): Promise<VersionSummary[]> {
  const { data, error } = await supabase
    .from("form_versions")
    .select(
      "id, version_number, status, published_at, profiles(full_name, email), responses(count)",
    )
    .eq("form_id", formId)
    .in("status", ["published", "archived"])
    .eq("responses.status", "completed")
    .order("version_number", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((v) => {
    const by = Array.isArray(v.profiles) ? v.profiles[0] : v.profiles;
    return {
      id: v.id,
      versionNumber: v.version_number,
      status: v.status as "published" | "archived",
      publishedAt: v.published_at,
      publishedBy: by?.full_name || by?.email || null,
      responseCount: (v.responses as { count: number }[] | null)?.[0]?.count ?? 0,
    };
  });
}

export class RestoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestoreError";
  }
}

/** Copies a published or archived version's schema into the draft (as
 * the signed-in editor; RLS decides). Returns the draft's new revision. */
export async function restoreVersionIntoDraft(
  supabase: Client,
  formId: string,
  versionId: string,
): Promise<{ revision: number; versionNumber: number }> {
  const { data: source } = await supabase
    .from("form_versions")
    .select("schema, version_number, status")
    .eq("id", versionId)
    .eq("form_id", formId)
    .in("status", ["published", "archived"])
    .maybeSingle();
  if (!source) throw new RestoreError("That version isn't there.");
  const { data: draft } = await supabase
    .from("form_versions")
    .select("id, revision")
    .eq("form_id", formId)
    .eq("status", "draft")
    .single();
  if (!draft) throw new RestoreError("The form has no draft.");
  const { data, error } = await supabase
    .from("form_versions")
    .update({ schema: source.schema, revision: draft.revision + 1 })
    .eq("id", draft.id)
    .eq("revision", draft.revision)
    .select("revision");
  if (error || !data?.length)
    throw new RestoreError("Couldn't restore it. Reload and try again.");
  return { revision: data[0].revision, versionNumber: source.version_number };
}
