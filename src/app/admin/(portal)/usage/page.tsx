import type { Metadata } from "next";
import Link from "next/link";
import { adminCall, requireStaff } from "@/lib/admin/staff";
import { PLAN_ENTITLEMENTS, type PlanId } from "@/domains/billing/catalog";

/** The plan's fair-use response level (pricing doc), or null. Responses
 * are never refused; above it, FormCraft may suggest a bigger plan. */
function fairUse(planId: string): number | null {
  const plan = PLAN_ENTITLEMENTS[planId as PlanId];
  return plan ? plan.responses_per_month : null;
}

export const metadata: Metadata = { title: "Usage" };

type Overview = {
  /** The database's date (UTC): the charts end on it. */
  today: string;
  totals: Record<"workspaces" | "users" | "forms" | "live_forms" | "responses", number>;
  active: Record<"7d" | "30d", { users: number; workspaces: number }>;
  signups_by_day: { day: string; count: number }[];
  submissions_by_day: { day: string; count: number }[];
  adoption: Record<string, number>;
  plans: Record<string, number>;
  statuses: Record<string, number>;
};

type Heavy = {
  id: string;
  name: string;
  plan_id: string;
  status: string;
  responses: number;
  ai_credits: number;
  storage: number;
  forms: number;
};

const ADOPTION_LABEL: Record<string, string> = {
  webhooks: "Webhooks",
  n8n: "n8n",
  slack: "Slack",
  apps: "Apps (CRM, Notion…)",
  sheets: "Google Sheets",
  payments: "Payments",
  custom_domains: "Custom domains",
  api_keys: "API keys",
  sso: "Single sign-on",
  bookings: "Bookings",
  experiments: "A/B tests",
  ai_this_month: "AI (this month)",
};

/** The last 30 days as bars, missing days as zero. */
function Days({
  data,
  label,
  today,
}: {
  data: { day: string; count: number }[];
  label: string;
  today: string;
}) {
  const byDay = new Map(data.map((d) => [d.day, Number(d.count)]));
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.parse(`${today}T00:00:00Z`) - (29 - i) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return { day: d, count: byDay.get(d) ?? 0 };
  });
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((n, d) => n + d.count, 0);
  return (
    <figure className="border-border flex flex-col gap-2 rounded-lg border-[1.5px] p-4">
      <figcaption className="flex justify-between text-sm">
        <b>{label}</b>
        <span className="text-muted-foreground">{total} in 30 days</span>
      </figcaption>
      <div
        className="flex h-24 items-end gap-[3px]"
        role="img"
        aria-label={`${label}: ${total} in 30 days`}
      >
        {days.map((d) => (
          <div
            key={d.day}
            title={`${d.day}: ${d.count}`}
            className="bg-ink min-h-px flex-1 rounded-t-[2px]"
            style={{ height: `${(d.count / max) * 100}%` }}
          />
        ))}
      </div>
    </figure>
  );
}

/** Active users and workspaces, adoption, volume and the heaviest
 * workspaces (ADM-043/044/052/055), counted from the real tables. */
export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  await requireStaff("ops.read");
  const { sort: rawSort } = await searchParams;
  const sort = ["responses", "ai_credits", "storage", "forms"].includes(rawSort ?? "")
    ? rawSort!
    : "responses";
  const [overview, heavy] = await Promise.all([
    adminCall<Overview>("admin_usage_overview"),
    adminCall<{ workspaces: Heavy[] }>("admin_resource_usage", {
      p_sort: sort,
      p_limit: 25,
    }),
  ]);
  if (!overview.ok) return <p>Couldn&apos;t load usage.</p>;
  const t = overview.totals;
  return (
    <main className="flex flex-col gap-5">
      <h1 className="font-heading text-2xl font-bold">Usage</h1>
      <section className="grid gap-3 sm:grid-cols-5">
        {[
          ["Workspaces", t.workspaces],
          ["Users", t.users],
          ["Forms (live)", `${t.forms} (${t.live_forms})`],
          ["Responses", t.responses],
          [
            "Active 7 / 30 days",
            `${overview.active["7d"].workspaces} / ${overview.active["30d"].workspaces} workspaces`,
          ],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="border-border rounded-lg border-[1.5px] p-3"
          >
            <div className="text-muted-foreground text-xs">{label}</div>
            <div className="text-lg font-semibold">{value}</div>
          </div>
        ))}
      </section>
      <p className="text-muted-foreground text-sm">
        Active users: {overview.active["7d"].users} signed in this week,{" "}
        {overview.active["30d"].users} this month. A workspace is active when it received
        a response, changed a form or had a member sign in.
      </p>
      <section className="grid gap-3 sm:grid-cols-2">
        <Days
          data={overview.submissions_by_day}
          label="Submissions"
          today={overview.today}
        />
        <Days data={overview.signups_by_day} label="Sign-ups" today={overview.today} />
      </section>
      <section className="grid gap-4 sm:grid-cols-3">
        <div>
          <h2 className="mb-2 font-semibold">Feature adoption (workspaces)</h2>
          <ul className="text-sm">
            {Object.entries(overview.adoption).map(([k, n]) => (
              <li key={k} className="flex justify-between border-b py-1">
                <span>{ADOPTION_LABEL[k] ?? k}</span>
                <b>{n}</b>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="mb-2 font-semibold">Plans</h2>
          <ul className="text-sm">
            {Object.entries(overview.plans).map(([k, n]) => (
              <li key={k} className="flex justify-between border-b py-1">
                <span>{k}</span>
                <b>{n}</b>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="mb-2 font-semibold">Account status</h2>
          <ul className="text-sm">
            {Object.entries(overview.statuses).map(([k, n]) => (
              <li key={k} className="flex justify-between border-b py-1">
                <span>{k}</span>
                <b>{n}</b>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="font-semibold">Heaviest workspaces this month</h2>
          <nav aria-label="Sort by" className="flex gap-2 text-sm">
            {[
              ["responses", "Responses"],
              ["ai_credits", "AI credits"],
              ["storage", "Storage"],
              ["forms", "Forms"],
            ].map(([key, label]) => (
              <Link
                key={key}
                href={`/admin/usage?sort=${key}`}
                aria-current={sort === key ? "page" : undefined}
                className={
                  sort === key
                    ? "font-semibold underline"
                    : "underline-offset-2 hover:underline"
                }
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="border-border overflow-x-auto rounded-lg border-[1.5px]">
          <table className="w-full text-left text-sm">
            <thead className="bg-background text-muted-foreground text-xs uppercase">
              <tr>
                <th className="px-3 py-2">Workspace</th>
                <th className="px-3 py-2">Plan</th>
                <th className="px-3 py-2">Responses</th>
                <th className="px-3 py-2">AI credits</th>
                <th className="px-3 py-2">Storage</th>
                <th className="px-3 py-2">Forms</th>
              </tr>
            </thead>
            <tbody>
              {(heavy.ok ? heavy.workspaces : []).map((w) => (
                <tr key={w.id} className="border-border border-t">
                  <td className="px-3 py-2">
                    <Link className="underline" href={`/admin/customers/${w.id}`}>
                      {w.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{w.plan_id}</td>
                  <td className="px-3 py-2">
                    {w.responses}
                    {fairUse(w.plan_id) !== null && w.responses > fairUse(w.plan_id)! && (
                      <span
                        className="ml-1.5 rounded-sm bg-[var(--chip-draft-bg)] px-1.5 py-px text-xs font-semibold text-[var(--chip-draft-fg)]"
                        title={`Above the ${w.plan_id} plan's fair-use level of ${fairUse(w.plan_id)!.toLocaleString()}`}
                      >
                        Over fair use
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{w.ai_credits}</td>
                  <td className="px-3 py-2">
                    {(Number(w.storage) / 1_048_576).toFixed(1)} MB
                  </td>
                  <td className="px-3 py-2">{w.forms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
