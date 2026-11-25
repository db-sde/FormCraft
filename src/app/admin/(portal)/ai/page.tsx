import type { Metadata } from "next";
import Link from "next/link";
import { adminCall, requireStaff } from "@/lib/admin/staff";
import { AiChangeForm, PauseAiForm } from "./ai-forms";
import { FEATURE_LABEL } from "./labels";

export const metadata: Metadata = { title: "AI" };

type Setting = {
  feature: string;
  enabled: boolean;
  model: string | null;
  max_tokens: number | null;
  daily_ceiling_usd: number | null;
  updated_at: string;
};

type Overview = {
  today: string;
  settings: Setting[];
  prices: {
    model: string;
    input: number;
    output: number;
    cache_read: number;
    cache_write: number;
  }[];
  spent_today_micros: number;
  by_day: { day: string; cost_micros: number; calls: number }[];
  by_feature: {
    feature: string;
    calls: number;
    cost_micros: number;
    refusals: number;
    errors: number;
    truncated: number;
    avg_latency_ms: number | null;
  }[];
  by_model: { model: string; calls: number; cost_micros: number }[];
  top_workspaces: { id: string; name: string; calls: number; cost_micros: number }[];
};

/** Models a setting may choose (the database refuses any other). */
const SELECTABLE = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];

/** Dollars from micro-dollars; tiny amounts keep two significant digits. */
function usd(micros: number) {
  const n = Number(micros) / 1_000_000;
  if (n === 0) return "$0.00";
  return n < 0.01 ? `$${n.toPrecision(2)}` : `$${n.toFixed(2)}`;
}

const th = "px-3 py-2";
const td = "px-3 py-2";

/** AI settings, spend against the daily ceiling, and cost by feature, model
 * and workspace (ADM-064/065/068/069). Changes need someone else's approval;
 * pausing doesn't. */
export default async function AiPage() {
  const { staff } = await requireStaff("ops.read");
  const overview = await adminCall<Overview>("admin_ai_overview");
  if (!overview.ok) return <p>Couldn&apos;t load AI.</p>;
  const platform = overview.settings.find((s) => s.feature === "*")!;
  const features = overview.settings.filter((s) => s.feature !== "*");
  const ceilingMicros = Number(platform.daily_ceiling_usd ?? 0) * 1_000_000;
  const spent = Number(overview.spent_today_micros);
  const canChange = staff.permissions.includes("ai.settings");
  const maxDay = Math.max(1, ...overview.by_day.map((d) => Number(d.cost_micros)));
  const month = overview.by_day.reduce((n, d) => n + Number(d.cost_micros), 0);

  return (
    <main className="flex flex-col gap-5">
      <h1 className="font-heading text-2xl font-bold">AI</h1>

      <section className="grid gap-3 sm:grid-cols-4">
        {[
          ["AI for customers", platform.enabled ? "On" : "Paused"],
          ["Default model", platform.model],
          [
            "Spent today (UTC)",
            platform.daily_ceiling_usd
              ? `${usd(spent)} of ${usd(ceilingMicros)}`
              : usd(spent),
          ],
          ["Last 30 days", usd(month)],
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
      {ceilingMicros > 0 && spent >= ceilingMicros && (
        <p role="alert" className="text-destructive text-sm font-semibold">
          Today&apos;s ceiling is reached: AI is paused for every customer until midnight
          UTC, or until the ceiling is raised.
        </p>
      )}

      <figure className="border-border flex flex-col gap-2 rounded-lg border-[1.5px] p-4">
        <figcaption className="flex justify-between text-sm">
          <b>Spend by day</b>
          <span className="text-muted-foreground">{usd(month)} in 30 days</span>
        </figcaption>
        <div
          className="flex h-24 items-end gap-[3px]"
          role="img"
          aria-label={`AI spend: ${usd(month)} in 30 days`}
        >
          {overview.by_day.map((d) => (
            <div
              key={d.day}
              title={`${d.day}: ${usd(d.cost_micros)}, ${d.calls} calls`}
              className="bg-ink min-h-px flex-1 rounded-t-[2px]"
              style={{ height: `${(Number(d.cost_micros) / maxDay) * 100}%` }}
            />
          ))}
        </div>
      </figure>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Features</h2>
        <div className="border-border overflow-x-auto rounded-lg border-[1.5px]">
          <table className="w-full text-left text-sm">
            <thead className="bg-background text-muted-foreground text-xs uppercase">
              <tr>
                <th className={th}>Feature</th>
                <th className={th}>On</th>
                <th className={th}>Model</th>
                <th className={th}>Max tokens</th>
                <th className={th}>Calls (30 d)</th>
                <th className={th}>Cost (30 d)</th>
                <th className={th}>Refused / failed / cut off</th>
                <th className={th}>Avg time</th>
              </tr>
            </thead>
            <tbody>
              {features.map((s) => {
                const use = overview.by_feature.find((f) => f.feature === s.feature);
                return (
                  <tr key={s.feature} className="border-border border-t">
                    <td className={td}>{FEATURE_LABEL[s.feature] ?? s.feature}</td>
                    <td className={td}>{s.enabled ? "Yes" : "Off"}</td>
                    <td className={td}>{s.model ?? `Default (${platform.model})`}</td>
                    <td className={td}>{s.max_tokens ?? "—"}</td>
                    <td className={td}>{use?.calls ?? 0}</td>
                    <td className={td}>{usd(use?.cost_micros ?? 0)}</td>
                    <td className={td}>
                      {use ? `${use.refusals} / ${use.errors} / ${use.truncated}` : "—"}
                    </td>
                    <td className={td}>
                      {use?.avg_latency_ms
                        ? `${(Number(use.avg_latency_ms) / 1000).toFixed(1)} s`
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h2 className="font-semibold">Top workspaces by cost (30 days)</h2>
          <ul className="text-sm">
            {overview.top_workspaces.length === 0 && (
              <li className="text-muted-foreground">No AI use yet.</li>
            )}
            {overview.top_workspaces.map((w) => (
              <li key={w.id} className="flex justify-between gap-2 border-b py-1">
                <Link className="underline" href={`/admin/customers/${w.id}`}>
                  {w.name}
                </Link>
                <span>
                  <b>{usd(w.cost_micros)}</b>{" "}
                  <span className="text-muted-foreground">({w.calls} calls)</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="font-semibold">By model (30 days)</h2>
          <ul className="text-sm">
            {overview.by_model.map((m) => (
              <li key={m.model} className="flex justify-between border-b py-1">
                <span>{m.model}</span>
                <span>
                  <b>{usd(m.cost_micros)}</b>{" "}
                  <span className="text-muted-foreground">({m.calls} calls)</span>
                </span>
              </li>
            ))}
          </ul>
          <h2 className="mt-2 font-semibold">Prices (US$ per million tokens)</h2>
          <table className="text-left text-sm">
            <thead className="text-muted-foreground text-xs">
              <tr>
                <th className="py-1 pr-3">Model</th>
                <th className="py-1 pr-3">In</th>
                <th className="py-1 pr-3">Out</th>
                <th className="py-1 pr-3">Cache read</th>
                <th className="py-1">Cache write</th>
              </tr>
            </thead>
            <tbody>
              {overview.prices.map((p) => (
                <tr key={p.model} className="border-border border-t">
                  <td className="py-1 pr-3">{p.model}</td>
                  <td className="py-1 pr-3">{Number(p.input)}</td>
                  <td className="py-1 pr-3">{Number(p.output)}</td>
                  <td className="py-1 pr-3">{Number(p.cache_read)}</td>
                  <td className="py-1">{Number(p.cache_write)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {canChange && (
        <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <AiChangeForm models={SELECTABLE} />
          {platform.enabled && <PauseAiForm />}
        </section>
      )}
    </main>
  );
}
