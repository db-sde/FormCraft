"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "cn";

/** Today as YYYY-MM-DD in this browser. */
function today(): string {
  return new Intl.DateTimeFormat("en-CA").format(new Date());
}

function addDays(date: string, days: number) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const subscribeNothing = () => () => {};
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/**
 * A week of free times (F-27), shown in the respondent's own time zone,
 * grouped by their local day. Keyboard: every time is a button; the week
 * moves with the arrows.
 */
export function SlotPicker({
  load,
  onPick,
  selected,
  busy = false,
  className,
}: {
  load: (from: string) => Promise<{ slots: string[]; timeZone: string }>;
  onPick: (start: string) => void;
  selected?: string;
  busy?: boolean;
  className?: string;
}) {
  const [from, setFrom] = useState(today);
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; slots: string[] }
    | { kind: "error"; message: string }
  >({ kind: "loading" });
  // The browser's zone, without a hydration mismatch (UTC on the server).
  const zone = useSyncExternalStore(subscribeNothing, browserZone, () => "UTC");

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setState({ kind: "loading" });
      try {
        const data = await load(from);
        if (!cancelled) setState({ kind: "ready", slots: data.slots });
      } catch {
        if (!cancelled)
          setState({ kind: "error", message: "Times couldn't be loaded. Try again." });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [from, load]);

  const days = useMemo(() => {
    if (state.kind !== "ready") return [];
    const groups = new Map<string, string[]>();
    const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: zone });
    for (const s of state.slots) {
      const key = dayKey.format(new Date(s));
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    return [...groups.entries()];
  }, [state, zone]);

  const dayLabel = (date: string) =>
    new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${date}T12:00:00Z`));
  const timeLabel = (iso: string) =>
    new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: zone,
    }).format(new Date(iso));

  return (
    <div
      className={cn("flex flex-col gap-3", className)}
      aria-busy={state.kind === "loading" || busy}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Earlier week"
          disabled={from <= today()}
          onClick={() => setFrom((f) => addDays(f, -7))}
          className="fc-focus grid size-8 place-items-center rounded-md border disabled:opacity-40"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="text-sm font-semibold">
          {dayLabel(from)} – {dayLabel(addDays(from, 6))}
        </span>
        <button
          type="button"
          aria-label="Later week"
          onClick={() => setFrom((f) => addDays(f, 7))}
          className="fc-focus grid size-8 place-items-center rounded-md border"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
      <p className="text-xs opacity-70">Times are in your time zone ({zone}).</p>
      {state.kind === "loading" && (
        <p className="text-sm opacity-70">Finding free times…</p>
      )}
      {state.kind === "error" && (
        <p role="alert" className="text-sm">
          {state.message}
        </p>
      )}
      {state.kind === "ready" && days.length === 0 && (
        <p className="text-sm opacity-70">No free times this week. Try the next one.</p>
      )}
      {days.map(([date, slots]) => (
        <section key={date} aria-label={dayLabel(date)} className="flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold">{dayLabel(date)}</h3>
          <div className="flex flex-wrap gap-1.5">
            {slots.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={selected === s}
                disabled={busy}
                onClick={() => onPick(s)}
                className={cn(
                  "fc-focus rounded-md border px-3 py-1.5 text-sm font-semibold",
                  selected === s &&
                    "bg-[var(--st-primary,#111)] text-[var(--st-on-primary,#fff)]",
                )}
              >
                {timeLabel(s)}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
