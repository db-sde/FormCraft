import type { Metadata } from "next";
import Link from "next/link";
import { adminCall, requireStaff } from "@/lib/admin/staff";
import { OpenRequestForm } from "./privacy-forms";
import { TYPE_LABEL } from "./labels";

export const metadata: Metadata = { title: "Privacy" };

type Overview = {
  now: string;
  open: {
    id: string;
    type: string;
    requester_email: string;
    received_at: string;
    due_at: string;
    verified: boolean;
    scoped_at: string | null;
    responses: number | null;
  }[];
  closed: {
    id: string;
    type: string;
    requester_email: string;
    status: string;
    completed_at: string;
  }[];
  retention: {
    job: string;
    ran_at: string;
    ok: boolean;
    counts: Record<string, unknown>;
    error: string | null;
    duration_ms: number | null;
  }[];
  files_waiting: number;
};

const day = (iso: string) => iso.slice(0, 10);

/** Privacy requests with their 30-day deadlines (ADM-085/086), and the
 * daily retention runs (ADM-091). */
export default async function PrivacyPage() {
  await requireStaff("privacy.manage");
  const overview = await adminCall<Overview>("admin_privacy_overview");
  if (!overview.ok) return <p>Couldn&apos;t load privacy requests.</p>;
  const now = Date.parse(overview.now);
  const latestByJob = new Map<string, Overview["retention"][number]>();
  for (const r of overview.retention)
    if (!latestByJob.has(r.job)) latestByJob.set(r.job, r);

  return (
    <main className="flex flex-col gap-5">
      <h1 className="font-heading text-2xl font-bold">Privacy</h1>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Open requests</h2>
        {overview.open.length === 0 ? (
          <p className="text-muted-foreground text-sm">None open.</p>
        ) : (
          <div className="border-border overflow-x-auto rounded-lg border-[1.5px]">
            <table className="w-full text-left text-sm">
              <thead className="bg-background text-muted-foreground text-xs uppercase">
                <tr>
                  <th className="px-3 py-2">Person</th>
                  <th className="px-3 py-2">Asks to</th>
                  <th className="px-3 py-2">Due</th>
                  <th className="px-3 py-2">Identity</th>
                  <th className="px-3 py-2">Found</th>
                </tr>
              </thead>
              <tbody>
                {overview.open.map((r) => {
                  const days = Math.ceil((Date.parse(r.due_at) - now) / 86_400_000);
                  return (
                    <tr key={r.id} className="border-border border-t">
                      <td className="px-3 py-2">
                        <Link className="underline" href={`/admin/privacy/${r.id}`}>
                          {r.requester_email}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{TYPE_LABEL[r.type] ?? r.type}</td>
                      <td
                        className={`px-3 py-2 ${days < 0 ? "text-destructive font-semibold" : days <= 5 ? "font-semibold" : ""}`}
                      >
                        {day(r.due_at)} (
                        {days < 0 ? `${-days} days late` : `${days} days left`})
                      </td>
                      <td className="px-3 py-2">{r.verified ? "Checked" : "Not yet"}</td>
                      <td className="px-3 py-2">
                        {r.scoped_at ? `${r.responses ?? 0} responses` : "Not searched"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <OpenRequestForm />

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h2 className="font-semibold">Recently closed</h2>
          <ul className="text-sm">
            {overview.closed.length === 0 && (
              <li className="text-muted-foreground">None yet.</li>
            )}
            {overview.closed.map((r) => (
              <li key={r.id} className="flex justify-between gap-2 border-b py-1">
                <Link className="underline" href={`/admin/privacy/${r.id}`}>
                  {r.requester_email}
                </Link>
                <span className="text-muted-foreground">
                  {TYPE_LABEL[r.type] ?? r.type} ·{" "}
                  {r.status === "completed" ? "done" : "refused"} {day(r.completed_at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="font-semibold">Retention (daily)</h2>
          {latestByJob.size === 0 ? (
            <p className="text-muted-foreground text-sm">No run recorded yet.</p>
          ) : (
            <ul className="text-sm">
              {[...latestByJob.values()].map((r) => (
                <li key={r.job} className="flex justify-between gap-2 border-b py-1">
                  <span>{r.job.replace(/_/g, " ")}</span>
                  <span className={r.ok ? "" : "text-destructive font-semibold"}>
                    {r.ok ? "OK" : `Failed: ${r.error ?? "unknown"}`} ·{" "}
                    {r.ran_at.slice(0, 16).replace("T", " ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted-foreground text-sm">
            Files from erasures waiting to be removed: {overview.files_waiting}
          </p>
        </div>
      </section>
    </main>
  );
}
