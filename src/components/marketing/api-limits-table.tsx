import {
  PLAN_ENTITLEMENTS,
  PLAN_NAMES,
  PUBLIC_PLAN_IDS,
} from "@/domains/billing/catalog";

const n = (v: number | null, none: string) => (v === null ? none : v.toLocaleString());

/** The published API limits (developer spec item 5), from catalog.ts:
 * the same table on /developers and /pricing. */
export function ApiLimitsTable() {
  return (
    <div className="border-ink overflow-x-auto rounded-xl border-[1.5px]">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="bg-card">
          <tr>
            <th className="px-3 py-2.5">Plan</th>
            <th className="px-3 py-2.5">Requests per minute</th>
            <th className="px-3 py-2.5">Burst</th>
            <th className="px-3 py-2.5">Requests per day</th>
            <th className="px-3 py-2.5">API keys</th>
          </tr>
        </thead>
        <tbody>
          {PUBLIC_PLAN_IDS.map((id) => {
            const e = PLAN_ENTITLEMENTS[id];
            return (
              <tr key={id} className="border-border border-t">
                <th scope="row" className="px-3 py-2 font-semibold">
                  {PLAN_NAMES[id]}
                </th>
                <td className="px-3 py-2">{n(e.api_requests_per_minute, "No limit")}</td>
                <td className="px-3 py-2">{n(e.api_burst, "No limit")}</td>
                <td className="px-3 py-2">
                  {n(e.api_requests_per_day, "No daily cap (fair use)")}
                </td>
                <td className="px-3 py-2">{n(e.api_keys, "Unlimited")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
