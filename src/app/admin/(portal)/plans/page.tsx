import type { Metadata } from "next";
import { adminCall, requireStaff } from "@/lib/admin/staff";
import { PlanEditor } from "./plan-editor";

export const metadata: Metadata = { title: "Plans" };

type Plan = {
  id: string;
  name: string;
  entitlements: Record<string, unknown>;
  workspaces: number;
};

/** Plans and what they include (ADM-029/030). Changing one applies to
 * every workspace on it, so it goes through an approved request. */
export default async function PlansPage() {
  const { staff } = await requireStaff("plans.read");
  const result = await adminCall<{
    plans: Plan[];
    keys: { key: string; kind: string }[];
  }>("admin_list_plans");
  const plans = result.ok ? result.plans : [];
  const keys = result.ok ? result.keys : [];
  const show = (v: unknown) =>
    v === null ? "unlimited" : v === true ? "✓" : v === false ? "—" : String(v);
  return (
    <main className="flex flex-col gap-5">
      <h1 className="font-heading text-2xl font-bold">Plans</h1>
      <div className="border-border overflow-x-auto rounded-lg border-[1.5px]">
        <table className="w-full text-left text-sm">
          <thead className="bg-background text-muted-foreground text-xs uppercase">
            <tr>
              <th className="px-3 py-2">Entitlement</th>
              {plans.map((p) => (
                <th key={p.id} className="px-3 py-2">
                  {p.name}
                  <div className="font-normal normal-case">{p.workspaces} workspaces</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.key} className="border-border border-t">
                <td className="px-3 py-1.5">
                  <code>{k.key}</code>
                </td>
                {plans.map((p) => (
                  <td key={p.id} className="px-3 py-1.5">
                    {k.key in p.entitlements ? (
                      show(p.entitlements[k.key])
                    ) : (
                      <span className="text-muted-foreground">default</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {staff.permissions.includes("plans.change") && (
        <PlanEditor
          plans={plans.map((p) => ({
            id: p.id,
            name: p.name,
            entitlements: p.entitlements,
          }))}
        />
      )}
    </main>
  );
}
