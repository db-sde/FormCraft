import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/** No row = enabled (opt-out model — most creators want the alert by
 * default; a row only ever exists to turn it off). */
export async function getNotificationsEnabled(
  supabase: Client,
  formId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("notification_settings")
    .select("enabled")
    .eq("form_id", formId)
    .maybeSingle();
  if (error) throw error;
  return data?.enabled ?? true;
}

export async function setNotificationsEnabled(
  supabase: Client,
  formId: string,
  enabled: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("notification_settings")
    .upsert({ form_id: formId, enabled }, { onConflict: "form_id" });
  if (error) throw error;
}
