/**
 * Conversion insights (PRD P3.8): plain-language observations worked
 * out from counts — no model, so the same data always says the same
 * thing. Each rule needs a minimum sample before it speaks; below that
 * it says there isn't enough data rather than reading noise.
 */

export type InsightDropoffStep = {
  questionId: string;
  label: string;
  required: boolean;
  /** Abandoned respondents whose last question was this one. */
  stopped: number;
};

export type SourceConversion = { source: string; started: number; completed: number };

export type Insight = {
  id: string;
  tone: "warning" | "positive" | "neutral";
  title: string;
  detail: string;
};

/** Abandoned sessions before drop-off is worth pointing at. */
export const MIN_ABANDONED = 5;
/** Starts a source needs before its rate is compared. */
export const MIN_SOURCE_STARTS = 10;
/** Percentage points from the overall rate that count as different. */
export const SOURCE_GAP_POINTS = 15;
/** Share of drop-offs at one question that makes it the bottleneck. */
const BOTTLENECK_SHARE = 0.3;

const pct = (n: number) => `${Math.round(n * 100)}%`;
const rate = (s: { started: number; completed: number }) =>
  s.started === 0 ? 0 : s.completed / s.started;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function buildInsights(input: {
  steps: InsightDropoffStep[];
  sources: SourceConversion[];
}): Insight[] {
  const insights: Insight[] = [];
  const abandoned = input.steps.reduce((sum, s) => sum + s.stopped, 0);

  // 1. The question most people leave at.
  if (abandoned >= MIN_ABANDONED) {
    const top = [...input.steps].sort((a, b) => b.stopped - a.stopped)[0];
    const share = top.stopped / abandoned;
    if (share >= BOTTLENECK_SHARE) {
      insights.push({
        id: `dropoff:${top.questionId}`,
        tone: "warning",
        title: `${pct(share)} of people who leave stop at “${top.label}”`,
        detail: top.required
          ? "It's required. Consider making it optional, rewording it, or asking it later in the form."
          : "Consider rewording it or asking it later in the form.",
      });
    }

    // 2. Required questions as a group.
    const atRequired = input.steps
      .filter((s) => s.required)
      .reduce((sum, s) => sum + s.stopped, 0);
    const requiredCount = input.steps.filter((s) => s.required).length;
    const requiredShare = atRequired / abandoned;
    const questionShare = input.steps.length ? requiredCount / input.steps.length : 0;
    // Only notable when required questions lose more than their share.
    if (
      requiredCount > 0 &&
      requiredShare >= 0.5 &&
      requiredShare > questionShare + 0.1
    ) {
      insights.push({
        id: "dropoff:required",
        tone: "warning",
        title: `${pct(requiredShare)} of drop-offs happen at required questions`,
        detail: `${plural(requiredCount, "required question")} of ${input.steps.length} account for most abandonment. Fewer required questions usually means more completions.`,
      });
    }
  }

  // 3. Traffic sources that convert unusually well or badly.
  const total = input.sources.reduce(
    (acc, s) => ({
      started: acc.started + s.started,
      completed: acc.completed + s.completed,
    }),
    { started: 0, completed: 0 },
  );
  const overall = rate(total);
  const comparable = input.sources
    .filter((s) => s.started >= MIN_SOURCE_STARTS)
    .sort((a, b) => b.started - a.started || a.source.localeCompare(b.source));
  // Comparing needs at least two sources with enough traffic.
  if (comparable.length >= 2) {
    const best = [...comparable].sort((a, b) => rate(b) - rate(a))[0];
    const worst = [...comparable].sort((a, b) => rate(a) - rate(b))[0];
    if ((rate(best) - overall) * 100 >= SOURCE_GAP_POINTS) {
      insights.push({
        id: `source:best:${best.source}`,
        tone: "positive",
        title: `${best.source} converts best: ${pct(rate(best))}`,
        detail: `${best.completed} of ${best.started} people from ${best.source} finished, against ${pct(overall)} overall.`,
      });
    }
    if (worst !== best && (overall - rate(worst)) * 100 >= SOURCE_GAP_POINTS) {
      insights.push({
        id: `source:worst:${worst.source}`,
        tone: "warning",
        title: `${worst.source} converts worst: ${pct(rate(worst))}`,
        detail: `${worst.completed} of ${worst.started} people from ${worst.source} finished, against ${pct(overall)} overall. Check what they're promised before they arrive.`,
      });
    }
  }

  if (insights.length === 0) {
    const enough = abandoned >= MIN_ABANDONED || comparable.length >= 2;
    insights.push(
      enough
        ? {
            id: "none",
            tone: "neutral",
            title: "Nothing stands out",
            detail:
              "Drop-off is spread out and traffic sources convert at similar rates.",
          }
        : {
            id: "not-enough-data",
            tone: "neutral",
            title: "Not enough data yet",
            detail: `Insights appear after ${MIN_ABANDONED} abandoned sessions, or ${MIN_SOURCE_STARTS} starts from each of two traffic sources.`,
          },
    );
  }
  return insights;
}
