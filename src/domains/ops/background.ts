import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { Send } from "@/domains/notifications/mailer";
import { renderEmailHtml } from "@/domains/notifications/email-layout";

type Client = SupabaseClient<Database>;

/**
 * Work the ops job does every 5 minutes for Super Admin Phase 4 (service
 * role): removing the stored files of erased responses, and sending
 * approved customer notices at a capped rate.
 */

/** Files per run, and per storage call. */
const FILES_PER_RUN = 400;
const FILES_PER_CALL = 100;

export async function removeQueuedFiles(
  admin: Client,
): Promise<{ removed: number; failed: number }> {
  const { data, error } = await admin.rpc("ops_storage_deletions_claim", {
    p_limit: FILES_PER_RUN,
  });
  if (error) throw error;
  const rows = data ?? [];
  const byBucket = new Map<string, { id: number; path: string }[]>();
  for (const r of rows) {
    const list = byBucket.get(r.bucket) ?? [];
    list.push({ id: r.id, path: r.path });
    byBucket.set(r.bucket, list);
  }
  let removed = 0;
  let failed = 0;
  for (const [bucket, items] of byBucket) {
    for (let i = 0; i < items.length; i += FILES_PER_CALL) {
      const chunk = items.slice(i, i + FILES_PER_CALL);
      // Removing a file that is already gone succeeds, so a retry is safe.
      const { error: removeError } = await admin.storage
        .from(bucket)
        .remove(chunk.map((c) => c.path));
      await admin.rpc("ops_storage_deletions_done", {
        p_ids: chunk.map((c) => c.id),
        p_error: removeError ? removeError.message : undefined,
      });
      if (removeError) failed += chunk.length;
      else removed += chunk.length;
    }
  }
  return { removed, failed };
}

/** Sends per run: every 5 minutes, so at most 600 an hour. */
const NOTICES_PER_RUN = 50;

const KIND_LABEL: Record<string, string> = {
  incident: "Service incident",
  billing: "Billing",
  policy: "Policy update",
  service: "Service notice",
};

/** Plain text for one notice (the HTML version escapes it). */
export function noticeText(body: string): string {
  return `${body}\n\nYou're getting this because you own a FormCraft workspace. It's a service notice about your account, not marketing.`;
}

export async function sendQueuedNotices(
  admin: Client,
  send: Send | null,
): Promise<{ sent: number; failed: number }> {
  if (!send) return { sent: 0, failed: 0 };
  const { data, error } = await admin.rpc("ops_message_claim", {
    p_limit: NOTICES_PER_RUN,
  });
  if (error) throw error;
  let sent = 0;
  let failed = 0;
  for (const n of data ?? []) {
    const result = await send({
      to: [n.email],
      subject: n.subject,
      text: noticeText(n.body),
      html: renderEmailHtml({
        tag: KIND_LABEL[n.kind] ?? "Notice",
        tagColor: n.kind === "incident" ? "#b42318" : "#2b2118",
        title: n.subject,
        body: n.body,
        fine: "You're getting this because you own a FormCraft workspace. It's a service notice about your account, not marketing.",
      }),
      // One send per recipient row, however many times it's tried.
      idempotencyKey: `notice-${n.id}`,
    });
    await admin.rpc("ops_message_result", {
      p_id: n.id,
      p_ok: result.ok,
      p_provider_id: result.ok ? (result.id ?? undefined) : undefined,
      p_error: result.ok ? undefined : "The email provider refused it",
    });
    if (result.ok) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}
