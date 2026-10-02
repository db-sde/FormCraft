import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { audit, type AuditAction } from "./log";

/** An account-level security event, recorded in every workspace the
 * person belongs to so each workspace's admins can see it. */
export async function auditUser(
  admin: SupabaseClient<Database>,
  userId: string,
  action: AuditAction,
): Promise<void> {
  const { data } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId);
  await Promise.all(
    (data ?? []).map((m) =>
      audit(admin, {
        workspaceId: m.workspace_id,
        actorId: userId,
        action,
        target: { type: "user", id: userId },
      }),
    ),
  );
}
