"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import {
  analyzeResponsesAction,
  setLeadCriteriaAction,
  summarizeResponsesAction,
} from "@/app/(form)/forms/[id]/(sections)/responses/ai-actions";
import type { InsightTotals, StoredSummary } from "@/domains/responses/ai-insights";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { cn } from "cn";

const SENTIMENTS = [
  ["positive", "Positive", "bg-[var(--chip-live-dot)]"],
  ["neutral", "Neutral", "bg-[var(--chip-pending-dot)]"],
  ["mixed", "Mixed", "bg-[var(--chip-draft-dot)]"],
  ["negative", "Negative", "bg-[var(--chip-failed-dot)]"],
] as const;

/** Summary tab: what AI has read out of the responses (P3.3–P3.6). The
 * creator starts every run; nothing is analysed on its own. */
export function AiInsightsPanel({
  formId,
  enabled,
  canRun,
  summary,
  totals,
  leadCriteria,
}: {
  formId: string;
  /** ANTHROPIC_API_KEY is set on the server. */
  enabled: boolean;
  /** The viewer may edit this form (running costs AI credits). */
  canRun: boolean;
  summary: StoredSummary | null;
  totals: InsightTotals;
  leadCriteria: string;
}) {
  const [pending, start] = useTransition();
  const [criteria, setCriteria] = useState(leadCriteria);

  if (!enabled) {
    return (
      <div className="border-input text-muted-foreground flex items-center gap-2.5 rounded-lg border-[1.5px] border-dashed px-4 py-3 text-[13.5px]">
        <Sparkles className="size-4 shrink-0" />
        AI summaries, sentiment and tags aren&apos;t set up on this server (set
        ANTHROPIC_API_KEY).
      </div>
    );
  }

  const analyze = () =>
    start(async () => {
      const result = await analyzeResponsesAction(formId);
      if (!result.ok) toast.error(result.message);
      else if (result.analyzed === 0 && result.failed === 0)
        toast.success("Every response is already analyzed.");
      else
        toast.success(
          `Analyzed ${result.analyzed} response${result.analyzed === 1 ? "" : "s"}.${
            result.outOfCredits
              ? " You're out of AI credits for this month."
              : result.remaining
                ? " Run it again for the rest."
                : ""
          }`,
        );
    });

  return (
    <section className="border-ink bg-card flex flex-col gap-5 rounded-lg border-[1.5px] p-[18px]">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-heading flex min-w-0 flex-1 items-center gap-2 text-base font-bold">
          <Sparkles className="size-4" aria-hidden />
          AI summary
        </h2>
        {canRun && (
          <>
            <Button variant="outline" size="sm" disabled={pending} onClick={analyze}>
              Analyze new responses
            </Button>
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await summarizeResponsesAction(formId);
                  if (result.ok) toast.success("Summary updated.");
                  else toast.error(result.message);
                })
              }
            >
              {summary ? "Refresh summary" : "Summarize responses"}
            </Button>
          </>
        )}
      </div>

      {summary ? (
        <div className="flex flex-col gap-4 text-sm">
          <p className="max-w-[70ch] leading-[1.6]">{summary.summary.overview}</p>
          {summary.summary.themes.length > 0 && (
            <ul className="grid gap-3 md:grid-cols-2">
              {summary.summary.themes.map((theme) => (
                <li key={theme.title} className="border-border rounded-lg border p-3.5">
                  <b>{theme.title}</b>
                  <p className="text-muted-foreground mt-1">{theme.description}</p>
                  {theme.quotes.map((quote) => (
                    <blockquote
                      key={quote}
                      className="border-primary mt-2 border-l-[3px] pl-2.5 text-[13px] italic"
                    >
                      “{quote}”
                    </blockquote>
                  ))}
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted-foreground text-[12.5px]">
            Written by AI from {summary.responseCount} response
            {summary.responseCount === 1 ? "" : "s"} on{" "}
            {new Date(summary.generatedAt).toLocaleDateString("en", {
              dateStyle: "medium",
            })}
            . Quotes are checked against the responses; the wording around them is the
            model&apos;s.
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          No summary yet. Summarizing reads the written answers (not emails, phone numbers
          or files) and uses one AI credit.
        </p>
      )}

      {totals.analyzed > 0 && (
        <div className="border-border grid gap-5 border-t pt-4 text-sm md:grid-cols-3">
          <div>
            <h3 className="text-muted-foreground mb-2 text-[11.5px] font-bold tracking-[0.1em] uppercase">
              Sentiment · {totals.analyzed} analyzed
            </h3>
            <ul className="flex flex-col gap-1.5">
              {SENTIMENTS.map(([key, label, color]) => (
                <li key={key} className="flex items-center gap-2">
                  <span aria-hidden className={cn("size-2 rounded-full", color)} />
                  <span className="flex-1">{label}</span>
                  <span className="tabular-nums">
                    {totals.sentiment[key]} ·{" "}
                    {Math.round((totals.sentiment[key] / totals.analyzed) * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-muted-foreground mb-2 text-[11.5px] font-bold tracking-[0.1em] uppercase">
              Top tags
            </h3>
            {totals.topTags.length === 0 ? (
              <p className="text-muted-foreground">None yet.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {totals.topTags.map(({ tag, count }) => (
                  <li
                    key={tag}
                    className="bg-muted rounded-full px-2.5 py-0.5 text-[12.5px]"
                  >
                    {tag}{" "}
                    <span className="text-muted-foreground tabular-nums">{count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="text-muted-foreground mb-2 text-[11.5px] font-bold tracking-[0.1em] uppercase">
              Average lead score
            </h3>
            <p className="font-heading text-2xl font-bold tabular-nums">
              {totals.averageLeadScore === null
                ? "—"
                : `${totals.averageLeadScore} / 100`}
            </p>
          </div>
        </div>
      )}

      {canRun && (
        <form
          className="border-border flex flex-col gap-2 border-t pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const result = await setLeadCriteriaAction(formId, criteria);
              if (result.ok)
                toast.success("Saved. New analyses will score against this.");
              else toast.error(result.message);
            });
          }}
        >
          <Label htmlFor="ai-lead-criteria">What makes a good lead? (optional)</Label>
          <Textarea
            id="ai-lead-criteria"
            value={criteria}
            maxLength={1000}
            rows={2}
            placeholder="Teams of 20+ that want to start within three months and have a budget."
            onChange={(e) => setCriteria(e.target.value)}
          />
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={pending || criteria.trim() === leadCriteria.trim()}
            >
              Save criteria
            </Button>
            <span className="text-muted-foreground text-[12.5px]">
              With criteria, each analyzed response gets a 0–100 score and a reason.
            </span>
          </div>
        </form>
      )}
    </section>
  );
}

const SENTIMENT_LABEL = Object.fromEntries(
  SENTIMENTS.map(([k, l, c]) => [k, [l, c]]),
) as Record<string, [string, string]>;

/** One response's analysis, with a button to run it (again). */
export function ResponseInsightCard({
  formId,
  responseId,
  enabled,
  canRun,
  insight,
}: {
  formId: string;
  responseId: string;
  enabled: boolean;
  canRun: boolean;
  insight: {
    sentiment: string | null;
    tags: string[];
    leadScore: number | null;
    leadReason: string | null;
  } | null;
}) {
  const [pending, start] = useTransition();
  if (!enabled || (!insight && !canRun)) return null;
  const sentiment = insight?.sentiment ? SENTIMENT_LABEL[insight.sentiment] : null;
  return (
    <section className="border-ink bg-card flex flex-col gap-2.5 rounded-lg border-[1.5px] px-[18px] py-4 text-sm">
      <div className="flex items-center gap-2">
        <h2 className="text-muted-foreground flex flex-1 items-center gap-1.5 text-[11.5px] font-bold tracking-[0.1em] uppercase">
          <Sparkles className="size-3.5" aria-hidden /> AI analysis
        </h2>
        {canRun && (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await analyzeResponsesAction(formId, responseId);
                if (!result.ok) toast.error(result.message);
                else if (result.analyzed === 0)
                  toast.error("There's nothing written in this response to analyze.");
                else toast.success("Analyzed.");
              })
            }
          >
            {insight ? "Analyze again" : "Analyze"}
          </Button>
        )}
      </div>
      {insight ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {sentiment && (
              <span className="flex items-center gap-1.5">
                <span aria-hidden className={cn("size-2 rounded-full", sentiment[1])} />
                {sentiment[0]}
              </span>
            )}
            {insight.tags.map((tag) => (
              <span
                key={tag}
                className="bg-muted rounded-full px-2.5 py-0.5 text-[12.5px]"
              >
                {tag}
              </span>
            ))}
          </div>
          {insight.leadScore !== null && (
            <p>
              <b className="tabular-nums">Lead score {insight.leadScore} / 100.</b>{" "}
              <span className="text-muted-foreground">{insight.leadReason}</span>
            </p>
          )}
        </>
      ) : (
        <p className="text-muted-foreground">Not analyzed yet.</p>
      )}
    </section>
  );
}
