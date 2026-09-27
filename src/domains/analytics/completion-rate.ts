export type AnalyticsEventLite = {
  eventType: string;
  isPreview: boolean;
};

/**
 * Completion Rate = completed submissions / valid starts × 100.
 * "Valid starts" = form_started events with isPreview=false. Never
 * substitute raw view/HTTP-request counts here (see ARCHITECTURE.md).
 * Returns null (not 0) when there are no valid starts, so callers can
 * render "no data yet" instead of a misleading 0%.
 */
export function computeCompletionRate(events: AnalyticsEventLite[]): number | null {
  const productionEvents = events.filter((e) => !e.isPreview);
  const starts = productionEvents.filter((e) => e.eventType === "form_started").length;
  const completions = productionEvents.filter(
    (e) => e.eventType === "form_submitted",
  ).length;

  if (starts === 0) return null;
  return (completions / starts) * 100;
}

export type FunnelSummary = {
  views: number;
  starts: number;
  completions: number;
  completionRate: number | null;
};

export function computeFunnelSummary(events: AnalyticsEventLite[]): FunnelSummary {
  const productionEvents = events.filter((e) => !e.isPreview);
  const views = productionEvents.filter((e) => e.eventType === "form_viewed").length;
  const starts = productionEvents.filter((e) => e.eventType === "form_started").length;
  const completions = productionEvents.filter(
    (e) => e.eventType === "form_submitted",
  ).length;

  return {
    views,
    starts,
    completions,
    completionRate: starts === 0 ? null : (completions / starts) * 100,
  };
}
