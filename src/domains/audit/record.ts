import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit, type AuditEntry } from "./log";

/**
 * Writes one audit entry (audit_logs accepts writes from the server
 * only). Lets server actions record what happened without holding a
 * service-role client themselves. Never throws.
 */
export function recordAudit(entry: AuditEntry): Promise<void> {
  return audit(createAdminClient(), entry);
}
