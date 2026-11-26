import { SettingsSection } from "@/components/dashboard/account-settings";
import { LocalTime } from "@/components/local-time";
import type { Entitlements } from "@/domains/billing/entitlements";

export type ApiUsageSummary = {
  /** The database's clock: the charts end there. */
  now: string;
  hourly: { hour: string; requests: number; limited: number }[];
  daily: { day: string; requests: number; limited: number }[];
  last_limited_at: string | null;
  last_limited_scope: "minute" | "day" | null;
};

const n = (v: number | null) => (v === null ? "No cap" : v.toLocaleString());

/** Bars for a series, with refusals stacked in red. */
function Bars({
  label,
  points,
}: {
  label: string;
  points: { key: string; title: string; requests: number; limited: number }[];
}) {
  const max = Math.max(1, ...points.map((p) => p.requests + p.limited));
  const total = points.reduce((s, p) => s + p.requests, 0);
  const refused = points.reduce((s, p) => s + p.limited, 0);
  return (
    <figure className="border-border flex flex-col gap-2 rounded-lg border-[1.5px] p-3">
      <figcaption className="flex justify-between text-sm">
        <b>{label}</b>
        <span className="text-muted-foreground">
          {total.toLocaleString()} requests
          {refused > 0 && ` · ${refused.toLocaleString()} refused`}
        </span>
      </figcaption>
      <div
        className="flex h-20 items-end gap-[2px]"
        role="img"
        aria-label={`${label}: ${total} requests, ${refused} refused`}
      >
        {points.map((p) => (
          <div
            key={p.key}
            title={`${p.title}: ${p.requests} requests${p.limited ? `, ${p.limited} refused` : ""}`}
            className="flex min-w-0 flex-1 flex-col justify-end"
            style={{ height: "100%" }}
          >
            <div
              className="bg-[var(--alert-error-border)]"
              style={{ height: `${(p.limited / max) * 100}%` }}
            />
            <div
              className="bg-ink min-h-px rounded-t-[2px]"
              style={{ height: `${(p.requests / max) * 100}%` }}
            />
          </div>
        ))}
      </div>
    </figure>
  );
}

/** Settings → API: the plan's limits, usage and the last refusal
 * (developer spec item 5). */
export function ApiUsage({
  entitlements,
  usage,
}: {
  entitlements: Entitlements;
  usage: ApiUsageSummary | null;
}) {
  const now = Date.parse(usage?.now ?? "1970-01-01T00:00:00Z");
  const byHour = new Map(
    (usage?.hourly ?? []).map((h) => [new Date(h.hour).toISOString().slice(0, 13), h]),
  );
  const hours = Array.from({ length: 24 }, (_, i) => {
    const d = new Date(now - (23 - i) * 3_600_000);
    const key = d.toISOString().slice(0, 13);
    const h = byHour.get(key);
    return {
      key,
      title: `${key.slice(11, 13)}:00 UTC`,
      requests: h?.requests ?? 0,
      limited: h?.limited ?? 0,
    };
  });
  const byDay = new Map((usage?.daily ?? []).map((d) => [d.day, d]));
  const days = Array.from({ length: 30 }, (_, i) => {
    const key = new Date(now - (29 - i) * 86_400_000).toISOString().slice(0, 10);
    const d = byDay.get(key);
    return {
      key,
      title: key,
      requests: Number(d?.requests ?? 0),
      limited: Number(d?.limited ?? 0),
    };
  });
  return (
    <SettingsSection
      title="API limits and usage"
      description="Limits apply to the whole workspace, across all its keys. Webhooks and integrations FormCraft sends don't count."
    >
      <dl className="grid gap-2 text-sm sm:grid-cols-4">
        {[
          ["Per minute", n(entitlements.api_requests_per_minute)],
          ["Burst", n(entitlements.api_burst)],
          ["Per day (UTC)", n(entitlements.api_requests_per_day)],
          [
            "Keys",
            entitlements.api_keys === null ? "Unlimited" : String(entitlements.api_keys),
          ],
        ].map(([label, value]) => (
          <div key={label} className="border-border rounded-sm border-[1.5px] px-3 py-2">
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd className="font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground text-sm">
        {usage?.last_limited_at ? (
          <>
            Last refused (HTTP 429): <LocalTime iso={usage.last_limited_at} />
            {usage.last_limited_scope === "day" ? ", daily limit" : ", per-minute limit"}.
          </>
        ) : (
          "No request has been refused."
        )}
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        <Bars label="Last 24 hours" points={hours} />
        <Bars label="Last 30 days" points={days} />
      </div>
    </SettingsSection>
  );
}
