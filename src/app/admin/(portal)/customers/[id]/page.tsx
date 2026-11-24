import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { adminCall, requireStaff } from "@/lib/admin/staff";
import { LocalTime } from "@/components/local-time";
import { WorkspaceChangeForms } from "./change-forms";

export const metadata: Metadata = { title: "Customer" };

type Profile = {
  workspace: {
    id: string;
    name: string;
    slug: string;
    created_at: string;
    plan_id: string;
    overrides: Record<string, unknown>;
    status: string;
    status_message: string | null;
    status_changed_at: string | null;
  };
  plan: { id: string; name: string; entitlements: Record<string, unknown> } | null;
  members: {
    email: string;
    role: string;
    joined_at: string;
    last_sign_in_at: string | null;
    second_factor: boolean;
  }[];
  usage: Record<string, number>;
  counts: {
    forms: number;
    live_forms: number;
    responses: number;
    responses_30d: number;
    storage_bytes: number;
  };
  integrations: {
    webhooks: Record<string, number>;
    connections: string[];
    custom_domains: string[];
  };
  recent_activity: { at: string; action: string; outcome: string }[];
  requests: { id: string; action: string; status: string; requested_at: string }[];
};

const UUID = /^[0-9a-f-]{36}$/i;

/** One customer's 360 view (ADM-009/010/012). No answers, files or
 * secrets; opening it is recorded in the audit trail. */
export default async function CustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { staff } = await requireStaff("customers.read");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [profile, plans] = await Promise.all([
    adminCall<Profile>("admin_customer_profile", { p_workspace_id: id }),
    staff.permissions.includes("plans.read")
      ? adminCall<{ plans: { id: string; name: string }[] }>("admin_list_plans")
      : Promise.resolve(null),
  ]);
  if (!profile.ok) notFound();
  const { workspace: w, counts, integrations } = profile;
  const mb = (n: number) => `${(n / 1_048_576).toFixed(1)} MB`;
  return (
    <main className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="font-heading text-2xl font-bold">{w.name}</h1>
        <span className="text-muted-foreground text-sm">{w.slug}</span>
        <span className="rounded-full border px-2 py-0.5 text-xs font-semibold">
          {w.status}
        </span>
      </div>
      {w.status !== "active" && w.status_message && (
        <p className="text-sm">Told the customer: “{w.status_message}”</p>
      )}
      <section className="grid gap-3 sm:grid-cols-4">
        {[
          ["Plan", profile.plan?.name ?? w.plan_id],
          ["Forms (live)", `${counts.forms} (${counts.live_forms})`],
          ["Responses (30 days)", `${counts.responses} (${counts.responses_30d})`],
          ["Storage", mb(Number(counts.storage_bytes))],
        ].map(([label, value]) => (
          <div key={label} className="border-border rounded-lg border-[1.5px] p-3">
            <div className="text-muted-foreground text-xs">{label}</div>
            <div className="text-lg font-semibold">{value}</div>
          </div>
        ))}
      </section>
      {Object.keys(w.overrides ?? {}).length > 0 && (
        <p className="text-sm">
          Overrides: <code>{JSON.stringify(w.overrides)}</code>
        </p>
      )}
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Members</h2>
        <div className="border-border overflow-x-auto rounded-lg border-[1.5px]">
          <table className="w-full text-left text-sm">
            <thead className="bg-background text-muted-foreground text-xs uppercase">
              <tr>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Two-factor</th>
                <th className="px-3 py-2">Last sign-in</th>
              </tr>
            </thead>
            <tbody>
              {profile.members.map((m) => (
                <tr key={m.email} className="border-border border-t">
                  <td className="px-3 py-2">{m.email}</td>
                  <td className="px-3 py-2">{m.role}</td>
                  <td className="px-3 py-2">{m.second_factor ? "On" : "Off"}</td>
                  <td className="px-3 py-2">
                    {m.last_sign_in_at ? <LocalTime iso={m.last_sign_in_at} /> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <h2 className="mb-1 font-semibold">Usage this month</h2>
          {Object.keys(profile.usage).length === 0 ? (
            <p className="text-muted-foreground">None yet.</p>
          ) : (
            <ul>
              {Object.entries(profile.usage).map(([k, v]) => (
                <li key={k}>
                  {k.replace(/_/g, " ")}: {v}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h2 className="mb-1 font-semibold">Integrations</h2>
          <p>
            Webhooks:{" "}
            {Object.entries(integrations.webhooks)
              .map(([k, n]) => `${k} ×${n}`)
              .join(", ") || "none"}
          </p>
          <p>Connections: {integrations.connections.join(", ") || "none"}</p>
          <p>Domains: {integrations.custom_domains.join(", ") || "none"}</p>
        </div>
        <div>
          <h2 className="mb-1 font-semibold">Recent activity</h2>
          <ul className="flex flex-col gap-0.5">
            {profile.recent_activity.slice(0, 8).map((a, i) => (
              <li key={i}>
                <LocalTime iso={a.at} variant="day" /> · <code>{a.action}</code>
              </li>
            ))}
          </ul>
        </div>
      </section>
      {(staff.permissions.includes("customers.status") ||
        staff.permissions.includes("plans.change")) && (
        <WorkspaceChangeForms
          workspaceId={w.id}
          currentStatus={w.status}
          currentPlan={w.plan_id}
          currentOverrides={w.overrides ?? {}}
          plans={plans?.ok ? plans.plans : []}
          canStatus={staff.permissions.includes("customers.status")}
          canPlan={staff.permissions.includes("plans.change")}
        />
      )}
      {profile.requests.length > 0 && (
        <section className="text-sm">
          <h2 className="mb-1 font-semibold">Change requests</h2>
          <ul>
            {profile.requests.map((r) => (
              <li key={r.id}>
                <LocalTime iso={r.requested_at} variant="day" /> · {r.action} · {r.status}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
