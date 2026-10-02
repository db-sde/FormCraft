import Link from "next/link";
import { BarChart3, Star } from "lucide-react";
import type {
  OutcomeSummary,
  QuestionSummary,
  ResponseSummary,
} from "@/domains/responses";
import { SUMMARY_RESPONSE_LIMIT } from "@/domains/responses";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "cn";

const fmt = (n: number | null, digits = 1) =>
  n === null ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(digits);

/** Per-question charts for completed responses (Part 5 §B). */
export function SummaryView({
  summary,
  tableHref,
}: {
  summary: ResponseSummary;
  /** The table with the same filters — "See all N answers". */
  tableHref: string;
}) {
  if (summary.total === 0) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Nothing to chart yet"
        description="Charts appear once people finish the form. Try a wider date range, or clear the filters."
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {summary.capped && (
        <p className="text-muted-foreground text-sm">
          Based on the newest {SUMMARY_RESPONSE_LIMIT.toLocaleString()} of{" "}
          {summary.total.toLocaleString()} responses. Add a date filter to narrow it down.
        </p>
      )}
      <Outcomes outcomes={summary.outcomes} />
      <div className="grid gap-[18px] md:grid-cols-2">
        {summary.questions.map((q) => (
          <SummaryCard key={q.questionId} question={q} tableHref={tableHref} />
        ))}
      </div>
    </div>
  );
}

function SummaryCard({
  question: q,
  tableHref,
}: {
  question: QuestionSummary;
  tableHref: string;
}) {
  return (
    <section className="border-ink bg-card flex min-w-0 flex-col gap-3 rounded-lg border-[1.5px] p-[18px]">
      <div className="flex items-start justify-between gap-2.5">
        <h3 className="font-heading min-w-0 text-base font-bold">
          {q.number} · {q.label}
        </h3>
        <span className="text-muted-foreground shrink-0 text-[13px]">
          {q.answered.toLocaleString()} answered
        </span>
      </div>
      {q.answered === 0 ? (
        <p className="text-muted-foreground text-sm">No answers yet.</p>
      ) : (
        <Body q={q} tableHref={tableHref} />
      )}
    </section>
  );
}

function Body({ q, tableHref }: { q: QuestionSummary; tableHref: string }) {
  switch (q.kind) {
    case "choice":
      return <Bars bars={q.bars} />;

    case "rating": {
      const filled = q.average === null ? 0 : Math.round(q.average);
      return (
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-heading text-[40px] leading-none font-bold">
            {fmt(q.average)}
          </span>
          <span className="flex gap-[3px]" aria-hidden>
            {Array.from({ length: q.scale }, (_, i) => (
              <Star
                key={i}
                className={cn(
                  "size-5",
                  i < filled ? "fill-primary text-primary" : "fill-border text-border",
                )}
              />
            ))}
          </span>
          <span className="text-muted-foreground text-[13px]">
            average of {q.answered.toLocaleString()}
          </span>
        </div>
      );
    }

    case "scale": {
      const peak = Math.max(1, ...q.counts.map((c) => c.count));
      return (
        <>
          <div className="flex flex-wrap items-baseline gap-2.5">
            {q.nps ? (
              <>
                <span className="font-heading text-[40px] leading-none font-bold">
                  {q.nps.score > 0 ? `+${q.nps.score}` : q.nps.score}
                </span>
                <span className="text-muted-foreground text-[13px]">
                  NPS · {q.nps.promoters}% promoters, {q.nps.detractors}% detractors
                </span>
              </>
            ) : (
              <>
                <span className="font-heading text-[40px] leading-none font-bold">
                  {fmt(q.average)}
                </span>
                <span className="text-muted-foreground text-[13px]">
                  average, from {q.min} to {q.max}
                </span>
              </>
            )}
          </div>
          <div className="flex h-[120px] items-end gap-[5px]" aria-hidden>
            {q.counts.map((c) => (
              <div
                key={c.value}
                className="flex h-full flex-1 flex-col items-center justify-end gap-1"
              >
                <div
                  className={cn(
                    "border-ink w-full rounded-t-[4px] border-[1.5px]",
                    !q.nps
                      ? "bg-accent"
                      : c.value <= 6
                        ? "bg-[var(--qt-scale-bg)]"
                        : c.value <= 8
                          ? "bg-muted"
                          : "bg-primary",
                  )}
                  style={{ height: `${Math.max(2, (c.count / peak) * 100)}%` }}
                  title={`${c.value}: ${c.count}`}
                />
                <span className="text-muted-foreground text-[11px]">{c.value}</span>
              </div>
            ))}
          </div>
          <ul className="sr-only">
            {q.counts.map((c) => (
              <li key={c.value}>
                {c.value}: {c.count}
              </li>
            ))}
          </ul>
        </>
      );
    }

    case "number":
      return (
        <div className="flex flex-wrap items-baseline gap-2.5">
          <span className="font-heading text-[40px] leading-none font-bold">
            {fmt(q.average)}
          </span>
          <span className="text-muted-foreground text-[13px]">
            average · lowest {fmt(q.min)}, highest {fmt(q.max)}
          </span>
        </div>
      );

    case "text":
      return (
        <>
          {q.quotes.map((quote, i) => (
            <blockquote
              key={i}
              className="bg-background line-clamp-3 rounded-sm px-3 py-2.5 text-sm leading-[1.45]"
            >
              “{quote}”
            </blockquote>
          ))}
          {q.answered > q.quotes.length && (
            <Link
              href={tableHref}
              className="decoration-primary self-start text-sm font-semibold underline decoration-2 underline-offset-2"
            >
              See all {q.answered.toLocaleString()} answers
            </Link>
          )}
        </>
      );

    case "count":
      return (
        <Link
          href={tableHref}
          className="decoration-primary self-start text-sm font-semibold underline decoration-2 underline-offset-2"
        >
          See them in the table
        </Link>
      );
  }
}

function Bars({ bars }: { bars: { label: string; count: number; percent: number }[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {bars.map((bar, i) => (
        <li key={bar.label} className="flex flex-col gap-1">
          <div className="flex justify-between gap-3 text-[13.5px]">
            <span className="min-w-0 truncate">{bar.label}</span>
            <b className="tabular-nums">{bar.percent}%</b>
          </div>
          <div className="bg-muted h-[22px] overflow-hidden rounded-[5px]">
            <div
              className={cn(
                "border-ink h-full",
                bar.percent > 0 && "border-r-[1.5px]",
                i === 0 && bar.count > 0 ? "bg-primary" : "bg-card",
              )}
              style={{ width: `${bar.percent}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Logic results (Phase 37): which endings people reached and what the
 * form worked out for them — only when the form has more than one place
 * to end or keeps variables. */
function Outcomes({ outcomes }: { outcomes: OutcomeSummary }) {
  const showEndings = outcomes.endings.length > 1;
  if (!showEndings && outcomes.variables.length === 0) return null;
  const card =
    "border-ink bg-card flex min-w-0 flex-col gap-3 rounded-lg border-[1.5px] p-[18px]";
  return (
    <section aria-labelledby="outcomes-heading" className="flex flex-col gap-3">
      <h2
        id="outcomes-heading"
        className="text-muted-foreground text-[11px] font-bold tracking-[0.1em] uppercase"
      >
        Results
      </h2>
      <div className="grid gap-[18px] md:grid-cols-2">
        {showEndings && (
          <section className={card}>
            <h3 className="font-heading text-base font-bold">Endings reached</h3>
            <Bars
              bars={outcomes.endings.map((e) => ({
                label: e.title,
                count: e.count,
                percent: e.percent,
              }))}
            />
          </section>
        )}
        {outcomes.variables.map((v) => (
          <section key={v.variableId} className={card}>
            <div className="flex items-start justify-between gap-2.5">
              <h3 className="min-w-0 font-mono text-[15px] font-bold">{v.name}</h3>
              <span className="text-muted-foreground shrink-0 text-[13px]">
                {v.count.toLocaleString()} response{v.count === 1 ? "" : "s"}
              </span>
            </div>
            {v.count === 0 ? (
              <p className="text-muted-foreground text-sm">Not set for anyone yet.</p>
            ) : v.kind === "number" ? (
              <div className="flex flex-wrap items-baseline gap-2.5">
                <span className="font-heading text-[40px] leading-none font-bold">
                  {fmt(v.average)}
                </span>
                <span className="text-muted-foreground text-[13px]">
                  average · lowest {fmt(v.min)}, highest {fmt(v.max)}
                </span>
              </div>
            ) : (
              <Bars bars={v.bars} />
            )}
          </section>
        ))}
      </div>
    </section>
  );
}
