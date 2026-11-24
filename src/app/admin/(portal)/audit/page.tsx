import type { Metadata } from "next";
import { adminCall, requireStaff } from "@/lib/admin/staff";
import { LocalTime } from "@/components/local-time";

export const metadata: Metadata = { title: "Audit trail" };

type Entry = {
  id: number;
  at: string;
  action: string;
  outcome: string;
  reason: string | null;
  target_type: string | null;
  target_id: string | null;
  staff_id: string | null;
  actor_user_id: string | null;
  ip: string | null;
  details: Record<string, unknown>;
};

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string }>;
}) {
  await requireStaff("audit.read");
  const { before } = await searchParams;
  const beforeId = before && /^\d+$/.test(before) ? Number(before) : null;
  const [status, trail] = await Promise.all([
    adminCall<{
      first_broken_id: number | null;
      entries: number;
      head_hash: string | null;
    }>("admin_audit_status"),
    adminCall<{ entries: Entry[] }>("admin_read_audit", {
      p_limit: 100,
      p_before: beforeId,
    }),
  ]);
  const entries = trail.ok ? trail.entries : [];
  return (
    <main className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-bold">Audit trail</h1>
      {status.ok && (
        <p
          role="status"
          className={
            status.first_broken_id === null
              ? "rounded-sm border-[1.5px] border-[var(--alert-success-border)] bg-[var(--alert-success-bg)] px-3 py-2 text-sm"
              : "rounded-sm border-[1.5px] border-[var(--alert-error-border)] bg-[var(--alert-error-bg)] px-3 py-2 text-sm"
          }
        >
          {status.first_broken_id === null
            ? `Intact: ${status.entries} entries, each linked to the one before.`
            : `Entry ${status.first_broken_id} was changed after it was written. Tell an owner now.`}{" "}
          {status.head_hash && (
            <span className="text-muted-foreground">
              Latest fingerprint <code>{status.head_hash.slice(0, 16)}…</code>
            </span>
          )}
        </p>
      )}
      <div className="border-border overflow-x-auto rounded-lg border-[1.5px]">
        <table className="w-full text-left text-sm">
          <thead className="bg-background text-muted-foreground text-xs uppercase">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Outcome</th>
              <th className="px-3 py-2">Target</th>
              <th className="px-3 py-2">Reason / detail</th>
              <th className="px-3 py-2">IP</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-border border-t align-top">
                <td className="px-3 py-2 whitespace-nowrap">
                  <LocalTime iso={e.at} />
                </td>
                <td className="px-3 py-2">
                  <code>{e.action}</code>
                </td>
                <td className="px-3 py-2">{e.outcome}</td>
                <td className="px-3 py-2">
                  {e.target_type
                    ? `${e.target_type} ${e.target_id?.slice(0, 8) ?? ""}`
                    : "—"}
                </td>
                <td className="px-3 py-2">
                  {e.reason ??
                    (Object.keys(e.details).length ? JSON.stringify(e.details) : "—")}
                </td>
                <td className="text-muted-foreground px-3 py-2">{e.ip ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {entries.length === 100 && (
        <a
          className="self-start text-sm underline"
          href={`/admin/audit?before=${entries[99].id}`}
        >
          Older entries
        </a>
      )}
    </main>
  );
}
