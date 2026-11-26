import type { Metadata } from "next";
import Link from "next/link";
import { adminCall, requireStaff } from "@/lib/admin/staff";
import { getBackupStatus } from "@/domains/observability/backups";
import { LocalTime } from "@/components/local-time";
import { RestoreTestForm } from "./restore-test-form";
import { DrillForm } from "./drill-form";
import { FeatureFlags, type FlagRow, type OverrideRow } from "./feature-flags";
import { DRILL_LABEL } from "./labels";

export const metadata: Metadata = { title: "Operations" };

type Queue = {
  pending: number;
  retrying: number;
  exhausted_24h: number;
  succeeded_24h: number;
  oldest_due: string | null;
};
type Health = {
  queues: Record<"webhooks" | "sheets" | "apps", Queue>;
  failing_endpoints: {
    endpoint_id: string;
    kind: string;
    form_title: string;
    workspace_name: string;
    workspace_id: string;
    failures: number;
    last_error: string | null;
  }[];
  scheduler: {
    calls_60m: number;
    ok_60m: number;
    last_ok_at: string | null;
    jobs: { name: string; schedule: string; active: boolean }[];
  };
  alerts: {
    kind: string;
    severity: string;
    message: string;
    first_seen_at: string;
    seen: number;
    notified_at: string | null;
  }[];
  restore_tests: {
    tested_at: string;
    backup_time: string | null;
    restored_to: string;
    checks: string;
    evidence_url: string | null;
    succeeded: boolean;
  }[];
};

type Drill = {
  id: number;
  kind: string;
  ran_at: string;
  scenario: string;
  outcome: string;
  succeeded: boolean;
  follow_ups: string | null;
  recorded_by: string | null;
};

const box = "border-border rounded-lg border-[1.5px] p-4";

/** Webhook operations, system health and backups (ADM-059/071/077). The
 * hosting, database and email consoles stay the place for the rest. */
export default async function OperationsPage() {
  const { staff } = await requireStaff("ops.read");
  const [health, backups, drills, flagData] = await Promise.all([
    adminCall<Health>("admin_ops_health"),
    getBackupStatus(),
    adminCall<{ drills: Drill[] }>("admin_list_drills"),
    adminCall<{ flags: FlagRow[]; overrides: OverrideRow[] }>("admin_list_feature_flags"),
  ]);
  if (!health.ok) return <p>Couldn&apos;t load operations.</p>;
  const s = health.scheduler;
  const schedulerOk = s.calls_60m === 0 || s.ok_60m > 0;
  return (
    <main className="flex flex-col gap-5">
      <h1 className="font-heading text-2xl font-bold">Operations</h1>

      <section className={box}>
        <h2 className="mb-2 font-semibold">Open alerts</h2>
        {health.alerts.length === 0 ? (
          <p className="text-sm">
            None. Checks run every 5 minutes; owners and admins are emailed.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {health.alerts.map((a) => (
              <li
                key={a.kind}
                className={
                  a.severity === "critical"
                    ? "rounded-sm bg-[var(--alert-error-bg)] px-3 py-2 text-[var(--alert-error-fg)]"
                    : "rounded-sm bg-[var(--alert-warning-bg)] px-3 py-2 text-[var(--alert-warning-fg)]"
                }
              >
                <b>{a.severity}</b> · {a.message}{" "}
                <span className="opacity-80">
                  (since <LocalTime iso={a.first_seen_at} />, seen {a.seen}×
                  {a.notified_at ? ", emailed" : ""})
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {(["webhooks", "sheets", "apps"] as const).map((k) => {
          const q = health.queues[k];
          return (
            <div key={k} className={box}>
              <h2 className="mb-1 font-semibold capitalize">{k}</h2>
              <ul className="text-sm">
                <li>Delivered (24 h): {q.succeeded_24h}</li>
                <li>Waiting: {q.pending}</li>
                <li>Retrying: {q.retrying}</li>
                <li>Gave up (24 h): {q.exhausted_24h}</li>
                <li>
                  Oldest due: {q.oldest_due ? <LocalTime iso={q.oldest_due} /> : "—"}
                </li>
              </ul>
            </div>
          );
        })}
      </section>

      <section className={box}>
        <h2 className="mb-2 font-semibold">Failing webhooks (24 hours)</h2>
        {health.failing_endpoints.length === 0 ? (
          <p className="text-sm">None.</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {health.failing_endpoints.map((e) => (
              <li key={e.endpoint_id}>
                <b>{e.failures}×</b> {e.kind} on “{e.form_title}” in{" "}
                <Link className="underline" href={`/admin/customers/${e.workspace_id}`}>
                  {e.workspace_name}
                </Link>
                {e.last_error && (
                  <span className="text-muted-foreground"> · {e.last_error}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-muted-foreground mt-2 text-xs">
          Failed deliveries retry for about a day; the response&apos;s timeline can send
          one again.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className={box}>
          <h2 className="mb-2 font-semibold">Scheduler</h2>
          <p
            className={
              schedulerOk
                ? "text-sm"
                : "text-sm font-semibold text-[var(--alert-error-fg)]"
            }
          >
            {s.ok_60m} of {s.calls_60m} calls to the app answered OK in the last hour
            {s.last_ok_at ? (
              <>
                ; last OK <LocalTime iso={s.last_ok_at} />
              </>
            ) : null}
            .
          </p>
          <ul className="text-muted-foreground mt-2 text-xs">
            {s.jobs.map((j) => (
              <li key={j.name}>
                {j.name} · <code>{j.schedule}</code>
                {j.active ? "" : " · paused"}
              </li>
            ))}
          </ul>
        </div>
        <div className={box}>
          <h2 className="mb-2 font-semibold">Backups</h2>
          {!backups.configured ? (
            <p className="text-sm">
              Not connected: set SUPABASE_MANAGEMENT_TOKEN (read-only backups) and
              SUPABASE_PROJECT_REF on this deployment.
            </p>
          ) : !backups.ok ? (
            <p className="text-sm">Couldn&apos;t check: {backups.error}.</p>
          ) : (
            <p
              className={
                backups.stale
                  ? "text-sm font-semibold text-[var(--alert-error-fg)]"
                  : "text-sm"
              }
            >
              {backups.pitrEnabled ? "Point-in-time recovery is on. " : ""}
              {backups.latestBackupAt ? (
                <>
                  Latest backup <LocalTime iso={backups.latestBackupAt} /> (
                  {backups.backups} kept).
                </>
              ) : (
                "No backups."
              )}
              {backups.stale &&
                " Nothing recent: upgrade the database plan or turn on point-in-time recovery."}
            </p>
          )}
          <h3 className="mt-3 text-sm font-semibold">Restore drills</h3>
          {health.restore_tests.length === 0 ? (
            <p className="text-sm">None recorded yet.</p>
          ) : (
            <ul className="text-sm">
              {health.restore_tests.map((t, i) => (
                <li key={i}>
                  <LocalTime iso={t.tested_at} variant="day" /> ·{" "}
                  {t.succeeded ? "worked" : "failed"} · {t.restored_to}
                  {t.evidence_url && (
                    <>
                      {" "}
                      ·{" "}
                      <a
                        className="underline"
                        href={t.evidence_url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        evidence
                      </a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {staff.permissions.includes("ops.record") && <RestoreTestForm />}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Other drills</h2>
        {!drills.ok || drills.drills.length === 0 ? (
          <p className="text-muted-foreground text-sm">None recorded yet.</p>
        ) : (
          <ul className="text-sm">
            {drills.drills.map((d) => (
              <li key={d.id} className="border-border border-b py-2">
                <b>{DRILL_LABEL[d.kind] ?? d.kind}</b> ·{" "}
                <LocalTime iso={d.ran_at} variant="day" /> ·{" "}
                {d.succeeded ? "went as planned" : "needs work"} · {d.recorded_by ?? "—"}
                <div className="text-muted-foreground">
                  {d.scenario} → {d.outcome}
                  {d.follow_ups ? ` Follow-ups: ${d.follow_ups}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {staff.permissions.includes("ops.record") && <DrillForm />}
      {flagData.ok && (
        <FeatureFlags
          flags={flagData.flags}
          overrides={flagData.overrides}
          canChange={staff.permissions.includes("ops.record")}
        />
      )}
    </main>
  );
}
