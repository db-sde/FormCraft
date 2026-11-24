import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rejectUnlessCron } from "@/lib/http/cron-auth";
import { getBackupStatus } from "@/domains/observability/backups";
import { defaultSender } from "@/domains/notifications/mailer";
import { renderEmailHtml } from "@/domains/notifications/email-layout";
import { hitRateLimit } from "@/domains/abuse/shared-rate-limit";

export const maxDuration = 60;

/**
 * Operations alerts (Super Admin Phase 2): runs the database's checks,
 * adds the backup check, keeps a daily copy of the audit trail's latest
 * fingerprint outside the database, and emails new alerts to owners and
 * admins. Every 5 minutes from the database scheduler and daily from
 * Vercel Cron, so a broken scheduler still gets reported. Protected by
 * CRON_SECRET; GET for Vercel Cron, POST for the database scheduler.
 */
async function run(request: NextRequest) {
  const rejected = rejectUnlessCron(request);
  if (rejected) return rejected;
  const admin = createAdminClient();
  await admin.rpc("ops_run_checks");

  // Backups: only with a token that can read them.
  const backups = await getBackupStatus();
  if (backups.configured) {
    const active = !backups.ok || backups.stale;
    await admin.rpc("ops_set_alert", {
      p_kind: "backup_stale",
      p_severity: "critical",
      p_message: !backups.ok
        ? `Backup status unavailable: ${backups.error}.`
        : backups.latestBackupAt
          ? `The latest database backup is from ${backups.latestBackupAt}, over 26 hours ago, and point-in-time recovery is off.`
          : "The database has no backups and point-in-time recovery is off.",
      p_details: backups.ok
        ? { latest: backups.latestBackupAt, pitr: backups.pitrEnabled }
        : {},
      p_active: active,
    });
  }

  // Once a day: the audit trail's latest fingerprint, kept outside the
  // database (in the logs, and in the owners' email when it's set up).
  const day = new Date().toISOString().slice(0, 10);
  const anchor = await hitRateLimit(
    admin,
    `ops-audit-anchor:${day}`,
    1,
    26 * 60 * 60 * 1000,
  );
  let anchorLine: string | null = null;
  if (anchor.allowed) {
    const { data } = await admin.rpc("admin_verify_audit_chain");
    const head = data?.[0];
    if (head) {
      anchorLine = `Audit trail on ${day}: ${head.entries} entries, latest fingerprint ${head.head_hash ?? "none"}${head.first_broken_id ? `, BROKEN at entry ${head.first_broken_id}` : ""}.`;
      console.info(JSON.stringify({ event: "audit_anchor", day, ...head }));
    }
  }

  const { data: alerts } = await admin.rpc("ops_alerts_to_notify");
  const pending = alerts ?? [];
  if (pending.length === 0 && !anchorLine) return NextResponse.json({ alerts: 0 });

  const { data: people } = await admin.rpc("ops_alert_recipients");
  const to = (people ?? []).map((p) => p.email).filter(Boolean);
  const send = defaultSender();
  const lines = pending.map((a) => `[${a.severity}] ${a.message}`);
  if (anchorLine) lines.push(anchorLine);
  let sent = false;
  if (send && to.length > 0) {
    const result = await send({
      to,
      subject:
        pending.length > 0
          ? `FormCraft operations: ${pending.length} alert${pending.length === 1 ? "" : "s"}`
          : "FormCraft operations: daily audit fingerprint",
      text: `${lines.join("\n")}\n\nDetails in the staff portal, Operations.`,
      html: renderEmailHtml({
        tag: "Operations",
        tagColor: "#b42318",
        title: pending.length > 0 ? "Something needs a look" : "Daily audit fingerprint",
        body: lines.join("\n"),
        fine: "Sent to FormCraft owners and admins. Details are in the staff portal under Operations.",
      }),
    });
    sent = result.ok;
  }
  if (!sent) {
    // No email set up (or it failed): the logs and the portal still have it.
    console.error(JSON.stringify({ event: "ops_alerts", alerts: lines }));
  }
  if (pending.length > 0) {
    await admin.rpc("ops_mark_notified", { p_ids: pending.map((a) => a.id) });
  }
  return NextResponse.json({ alerts: pending.length, emailed: sent });
}

export const GET = run;
export const POST = run;
