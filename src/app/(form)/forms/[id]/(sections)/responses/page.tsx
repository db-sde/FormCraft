import type { Metadata } from "next";
import Link from "next/link";
import {
  BarChart3,
  Calendar,
  Download,
  Flag,
  Inbox,
  Lightbulb,
  Plus,
  Send,
  Table2,
} from "lucide-react";
import {
  getConversionInsights,
  getDropoff,
  getLatestSchema,
  getResponseCounts,
  getResponseSummary,
  listResponses,
  responseActivity,
  RESPONSE_PERIODS,
  filtersFromParams,
  type AnswerFilter,
  type DropoffStep,
  type ResponseFilters,
  type ResponseView,
} from "@/domains/responses";
import { getFunnelSummaryForForm } from "@/domains/analytics";
import type { Insight } from "@/domains/analytics/insights";
import type { QuestionV1 } from "@/domains/forms/schema/v1";
import { DeleteResponseButton } from "@/components/responses/delete-response-button";
import { ActivityChip } from "@/components/responses/activity-chip";
import { FilterChip, type FilterGroup } from "@/components/responses/filter-chip";
import { SummaryView } from "@/components/responses/summary-view";
import { FormSectionHeader } from "@/components/forms/form-top-bar";
import { FormPageActions } from "@/components/forms/form-page-actions";
import { CopyLinkField } from "@/components/forms/copy-link-field";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Pagination } from "@/components/shared/pagination";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/local-time";
import { loadFormForPage } from "../../load-form";
import { ABANDONED_AFTER_MINUTES } from "@/domains/responses/activity";
import { cn } from "cn";
import { hasPermission } from "@/domains/workspaces/permissions";

const PAGE_SIZE = 25;

const PERIODS = RESPONSE_PERIODS;

type Params = {
  page?: string;
  view?: string;
  tab?: string;
  period?: string;
  ending?: string;
  q?: string;
  a?: string;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { form } = await loadFormForPage(id);
  return { title: `${form.title} · Responses` };
}

/** Choice questions a response can be filtered by, with their answers. */
function answerChoices(
  question: QuestionV1,
): { label: string; value: string | boolean }[] {
  switch (question.type) {
    case "single_select":
    case "multi_select":
    case "dropdown":
      return question.settings.options.map((o) => ({
        label: o.label || "Untitled option",
        value: o.id,
      }));
    case "yes_no":
      return [
        { label: question.settings.yesLabel || "Yes", value: true },
        { label: question.settings.noLabel || "No", value: false },
      ];
    default:
      return [];
  }
}

/** Where abandoned respondents stopped, question by question. */
function DropoffCard({ steps, total }: { steps: DropoffStep[]; total: number }) {
  if (total === 0) return null;
  const max = Math.max(...steps.map((s) => s.stopped));
  return (
    <section className="border-ink bg-card rounded-lg border-[1.5px] p-[18px]">
      <h2 className="font-heading text-base font-bold">Where people drop off</h2>
      <p className="text-muted-foreground mb-4 text-sm">
        The last question {total} abandoned respondent{total === 1 ? "" : "s"} saw before
        leaving (inactive {ABANDONED_AFTER_MINUTES}+ minutes).
      </p>
      <ol className="flex flex-col gap-2.5">
        {steps.map((step, i) => (
          <li
            key={step.questionId}
            className="grid grid-cols-[1.5rem_1fr_auto] items-center gap-3 text-sm"
          >
            <span className="text-muted-foreground tabular-nums">{i + 1}</span>
            <div className="min-w-0">
              <p className="truncate">{step.label}</p>
              <div className="bg-muted mt-1 h-2.5 overflow-hidden rounded-[4px]">
                <div
                  className={cn(
                    "border-ink h-full",
                    step.stopped > 0 && "border-r-[1.5px]",
                    step.stopped === max ? "bg-[var(--chip-changes-dot)]" : "bg-primary",
                  )}
                  style={{ width: `${max ? (step.stopped / max) * 100 : 0}%` }}
                />
              </div>
            </div>
            <span className="text-muted-foreground w-24 text-right tabular-nums">
              {step.stopped} · {Math.round((step.stopped / total) * 100)}%
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

const INSIGHT_TONE: Record<Insight["tone"], string> = {
  warning: "bg-[var(--chip-changes-dot)]",
  positive: "bg-[var(--chip-live-dot)]",
  neutral: "bg-[var(--chip-pending-dot)]",
};

/** Conversion insights (P3.8), worked out from counts. */
function InsightsCard({ insights }: { insights: Insight[] }) {
  return (
    <section className="border-ink bg-card rounded-lg border-[1.5px] p-[18px]">
      <h2 className="font-heading mb-3 flex items-center gap-2 text-base font-bold">
        <Lightbulb className="size-4" aria-hidden />
        Insights
      </h2>
      <ul className="flex flex-col gap-3">
        {insights.map((insight) => (
          <li key={insight.id} className="flex gap-3 text-sm">
            <span
              aria-hidden
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full",
                INSIGHT_TONE[insight.tone],
              )}
            />
            <div>
              <p className="font-medium">{insight.title}</p>
              <p className="text-muted-foreground">{insight.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProgressBar({ answered, total }: { answered: number; total: number }) {
  const percent = total === 0 ? 0 : Math.round((answered / total) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="bg-muted h-2 w-20 overflow-hidden rounded-full">
        <div
          className="bg-primary h-full rounded-full"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-muted-foreground text-xs tabular-nums">
        {answered}/{total}
      </span>
    </div>
  );
}

export default async function ResponsesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Params>;
}) {
  const { id: formId } = await params;
  const sp = await searchParams;
  const {
    supabase,
    workspace,
    form,
    isLive,
    publishState,
    hasUnpublishedChanges,
    viewOnly,
  } = await loadFormForPage(formId);

  // Granular permissions (P3.15): row-level security hides the data;
  // say why instead of showing an empty list.
  if (!(await hasPermission(supabase, workspace.id, "view_responses"))) {
    return (
      <div className="flex flex-col gap-6">
        <FormSectionHeader
          formId={formId}
          title={form.title}
          active="responses"
          state={publishState}
          hasChanges={hasUnpublishedChanges}
        />
        <p className="text-muted-foreground text-sm">
          You don&apos;t have permission to see this form&apos;s responses. Ask a
          workspace admin if you need it.
        </p>
      </div>
    );
  }

  const view: ResponseView = sp.view === "incomplete" ? "incomplete" : "completed";
  const completed = view === "completed";
  const tab = completed && sp.tab === "summary" ? "summary" : "table";
  const period: (typeof PERIODS)[number] =
    PERIODS.find((p) => p.id === sp.period) ?? PERIODS[PERIODS.length - 1];
  const page = Math.max(1, Number(sp.page) || 1);

  const latest = await getLatestSchema(supabase, formId);
  const endings = latest?.endings ?? [];
  const choiceQuestions = (latest?.questions ?? [])
    .map((q) => ({ question: q, choices: answerChoices(q) }))
    .filter((c) => c.choices.length > 0);

  // Only accept an ending / answer that exists on the form.
  const ending = completed ? endings.find((e) => e.id === sp.ending) : undefined;
  const answerQuestion = choiceQuestions.find((c) => c.question.id === sp.q);
  const answerChoice = answerQuestion?.choices.find((c) => String(c.value) === sp.a);
  const answer: AnswerFilter | undefined =
    answerQuestion && answerChoice
      ? { questionId: answerQuestion.question.id, value: answerChoice.value }
      : undefined;

  const filters: ResponseFilters = {
    since: filtersFromParams({ period: period.id }).since,
    endingId: ending?.id,
    answer,
  };

  const [responses, counts, funnel, dropoff, summary, insights] = await Promise.all([
    tab === "table" ? listResponses(supabase, formId, { page, view, ...filters }) : null,
    getResponseCounts(supabase, formId),
    getFunnelSummaryForForm(supabase, formId, filters.since),
    view === "incomplete" ? getDropoff(supabase, formId) : null,
    tab === "summary" ? getResponseSummary(supabase, formId, filters) : null,
    tab === "summary" ? getConversionInsights(supabase, formId, filters.since) : null,
  ]);

  const base = `/forms/${formId}/responses`;
  const current = {
    view: completed ? undefined : "incomplete",
    tab: tab === "summary" ? "summary" : undefined,
    period: period.id === "all" ? undefined : period.id,
    ending: ending?.id,
    q: answer?.questionId,
    a: answer ? String(answer.value) : undefined,
  };
  const href = (
    patch: Partial<Record<keyof typeof current | "page", string | undefined>>,
  ) => {
    const merged = { ...current, ...patch };
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) qs.set(k, v);
    const s = qs.toString();
    return s ? `${base}?${s}` : base;
  };
  const filtered = !!(filters.since || ending || answer);

  const answerGroups: FilterGroup[] = choiceQuestions.map(({ question, choices }) => ({
    label: question.label || "Untitled question",
    options: choices.map((c) => ({
      label: c.label,
      href: href({ q: question.id, a: String(c.value), page: undefined }),
      selected: answer?.questionId === question.id && answer.value === c.value,
    })),
  }));

  const totalCount = responses?.totalCount ?? summary?.total ?? 0;
  const hasAnyResponses = counts.completed + counts.partial > 0;

  return (
    <div className="flex flex-col gap-5">
      <FormSectionHeader
        formId={formId}
        title={form.title}
        active="responses"
        state={publishState}
        hasChanges={hasUnpublishedChanges}
        actions={<FormPageActions formId={formId} isLive={isLive} />}
      />

      {!hasAnyResponses ? (
        !isLive ? (
          <EmptyState
            icon={Inbox}
            tint="var(--chip-draft-bg)"
            title="No responses yet"
            description="This form is still a draft, so nobody can fill it in. Publish it to get a link you can share."
            actions={
              <Button asChild size="lg">
                <Link href={`/forms/${formId}`}>Open the builder to publish</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Send}
            tint="var(--chip-live-bg)"
            title="You're live. Now share it."
            description="Responses show up here as soon as someone finishes the form, and partial ones too."
            actions={
              <div className="flex w-full max-w-[436px] flex-col items-center gap-3">
                <CopyLinkField slug={form.slug} />
                <Link
                  href={`/forms/${formId}/share`}
                  className="text-[13.5px] font-semibold underline underline-offset-2"
                >
                  More ways to share (QR, embed)
                </Link>
              </div>
            }
          />
        )
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <div className="font-heading text-[26px] leading-none font-bold">
                {completed
                  ? `${totalCount.toLocaleString()} response${totalCount === 1 ? "" : "s"}`
                  : `${totalCount.toLocaleString()} unfinished session${totalCount === 1 ? "" : "s"}`}
              </div>
              <div className="text-muted-foreground mt-1.5 text-sm">
                {completed ? (
                  counts.partial > 0 ? (
                    <>
                      Plus {counts.partial.toLocaleString()} unfinished session
                      {counts.partial === 1 ? "" : "s"}, not shown below.{" "}
                      <Link
                        href={href({
                          view: "incomplete",
                          tab: undefined,
                          ending: undefined,
                          page: undefined,
                        })}
                        className="text-foreground decoration-primary font-semibold underline decoration-2 underline-offset-2"
                      >
                        Show partial responses
                      </Link>
                    </>
                  ) : (
                    "Everyone who reached an ending."
                  )
                ) : (
                  <>
                    People who answered something but didn&apos;t submit.{" "}
                    <Link
                      href={href({ view: undefined, page: undefined })}
                      className="text-foreground decoration-primary font-semibold underline decoration-2 underline-offset-2"
                    >
                      Show completed responses
                    </Link>
                  </>
                )}
              </div>
            </div>
            {tab === "table" && totalCount > 0 && (
              <Button asChild variant="outline">
                <a
                  href={`/api/forms/${formId}/export.csv${href({ tab: undefined, page: undefined }).slice(base.length)}`}
                  download
                >
                  <Download />
                  Export CSV
                </a>
              </Button>
            )}
          </div>

          {completed && (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <StatCard
                label="Views"
                value={funnel.views.toLocaleString()}
                hint="Times the form was opened"
              />
              <StatCard
                label="Starts"
                value={funnel.starts.toLocaleString()}
                hint={
                  funnel.views > 0
                    ? `${Math.round((funnel.starts / funnel.views) * 100)}% of views`
                    : "Began answering"
                }
              />
              <StatCard
                label="Completions"
                value={funnel.completions.toLocaleString()}
                hint="Reached an ending"
              />
              <StatCard
                label="Completion rate"
                value={
                  funnel.completionRate === null
                    ? "—"
                    : `${Math.round(funnel.completionRate)}%`
                }
                hint={`${funnel.completions.toLocaleString()} of ${funnel.starts.toLocaleString()} starts`}
                className="shadow-card"
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5">
            {completed && (
              <div
                role="tablist"
                aria-label="Show as"
                className="border-ink bg-card flex gap-0.5 rounded-[8px] border-[1.5px] p-[3px] text-[13.5px] font-semibold"
              >
                {(
                  [
                    ["table", "Table", Table2],
                    ["summary", "Summary", BarChart3],
                  ] as const
                ).map(([id, label, Icon]) => (
                  <Link
                    key={id}
                    role="tab"
                    aria-selected={tab === id}
                    href={href({
                      tab: id === "summary" ? "summary" : undefined,
                      page: undefined,
                    })}
                    scroll={false}
                    className={cn(
                      "fc-focus flex items-center gap-1.5 rounded-[5px] px-3 py-[5px]",
                      tab === id
                        ? "bg-secondary text-secondary-foreground"
                        : "text-muted-foreground hover:bg-hover-wash hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3.5" />
                    {label}
                  </Link>
                ))}
              </div>
            )}
            <FilterChip
              icon={<Calendar />}
              label={period.label}
              active={period.id !== "all"}
              clearHref={href({ period: undefined, page: undefined })}
              clearLabel="Clear the date filter"
              options={PERIODS.map((p) => ({
                label: p.label,
                href: href({
                  period: p.id === "all" ? undefined : p.id,
                  page: undefined,
                }),
                selected: p.id === period.id,
              }))}
            />
            {completed && endings.length > 1 && (
              <FilterChip
                icon={<Flag />}
                label={ending ? ending.title || "Untitled ending" : "Ending"}
                active={!!ending}
                clearHref={href({ ending: undefined, page: undefined })}
                clearLabel="Clear the ending filter"
                options={endings.map((e) => ({
                  label: e.title || "Untitled ending",
                  href: href({ ending: e.id, page: undefined }),
                  selected: e.id === ending?.id,
                }))}
              />
            )}
            {answerGroups.length > 0 && (
              <FilterChip
                icon={<Plus />}
                label={
                  answer && answerQuestion && answerChoice
                    ? `${answerQuestion.question.label || "Untitled question"}: ${answerChoice.label}`
                    : "Filter by answer"
                }
                active={!!answer}
                clearHref={href({ q: undefined, a: undefined, page: undefined })}
                clearLabel="Clear the answer filter"
                groups={answerGroups}
              />
            )}
          </div>

          {!completed && dropoff && <DropoffCard {...dropoff} />}

          {insights && <InsightsCard insights={insights} />}

          {summary && (
            <SummaryView
              summary={summary}
              tableHref={href({ tab: undefined, page: undefined })}
            />
          )}

          {responses &&
            (responses.items.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title={
                  filtered
                    ? "No responses match these filters"
                    : completed
                      ? "No completed responses yet"
                      : "No unfinished sessions"
                }
                description={
                  filtered
                    ? "Try a wider date range or clear a filter."
                    : completed
                      ? "Responses show up here as soon as someone finishes the form."
                      : "Everyone who started this form either finished it or hasn't answered anything yet."
                }
                actions={
                  filtered ? (
                    <Button asChild variant="outline">
                      <Link
                        href={href({
                          period: undefined,
                          ending: undefined,
                          q: undefined,
                          a: undefined,
                          page: undefined,
                        })}
                      >
                        Clear filters
                      </Link>
                    </Button>
                  ) : null
                }
              />
            ) : (
              <>
                {/* Phone: one card per response. */}
                <ul className="flex flex-col gap-2.5 md:hidden">
                  {responses.items.map((item) => {
                    const first = responses.previewColumns[0];
                    return (
                      <li
                        key={item.id}
                        className="border-ink bg-card relative flex flex-col gap-1.5 rounded-lg border-[1.5px] p-3.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Link
                            href={`${base}/${item.id}`}
                            className="min-w-0 truncate font-semibold after:absolute after:inset-0"
                          >
                            {(first && item.preview[first.questionId]) || "Anonymous"}
                          </Link>
                          {completed ? (
                            <ActivityChip activity="completed" />
                          ) : (
                            <ActivityChip
                              activity={responseActivity({
                                status: item.status,
                                lastActiveAt: item.lastActiveAt,
                              })}
                            />
                          )}
                        </div>
                        <span className="text-muted-foreground text-[13px]">
                          <LocalTime
                            variant="day"
                            iso={
                              completed
                                ? (item.completedAt ?? item.lastActiveAt)
                                : item.lastActiveAt
                            }
                          />
                          {completed
                            ? item.endingTitle && ` · ${item.endingTitle}`
                            : ` · ${item.progress.answered} of ${item.progress.total} answered${
                                item.lastQuestionLabel
                                  ? ` · stopped at ${item.lastQuestionLabel}`
                                  : ""
                              }`}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                <div className="border-ink bg-card hidden overflow-x-auto rounded-lg border-[1.5px] md:block">
                  <table className="w-full min-w-[720px] table-fixed border-collapse text-sm">
                    <thead>
                      <tr className="bg-background border-ink text-muted-foreground border-b-[1.5px] text-left text-[11.5px] font-bold tracking-[0.08em] uppercase">
                        <th scope="col" className="w-[170px] px-4 py-2.5 font-bold">
                          {completed ? "Submitted" : "Last active"}
                        </th>
                        {responses.previewColumns.map((col) => (
                          <th
                            key={col.questionId}
                            scope="col"
                            className="truncate px-4 py-2.5 font-bold"
                          >
                            {col.label}
                          </th>
                        ))}
                        {completed ? (
                          <th scope="col" className="w-[160px] px-4 py-2.5 font-bold">
                            Ending
                          </th>
                        ) : (
                          <>
                            <th scope="col" className="w-[130px] px-4 py-2.5 font-bold">
                              Progress
                            </th>
                            <th scope="col" className="w-[180px] px-4 py-2.5 font-bold">
                              Stopped at
                            </th>
                            <th scope="col" className="w-[130px] px-4 py-2.5 font-bold">
                              Status
                            </th>
                          </>
                        )}
                        <th scope="col" className="w-[60px] px-2">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {responses.items.map((item) => (
                        <tr
                          key={item.id}
                          className="group border-border hover:bg-accent relative h-[50px] border-b last:border-b-0"
                        >
                          <td className="px-4 whitespace-nowrap">
                            {/* ::after stretches this link over the whole row;
                                the delete button sits above it (z-10). */}
                            <Link
                              href={`${base}/${item.id}`}
                              className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:shadow-[inset_0_0_0_2px_var(--ring)]"
                            >
                              <LocalTime
                                variant="day"
                                iso={
                                  completed
                                    ? (item.completedAt ?? item.lastActiveAt)
                                    : item.lastActiveAt
                                }
                              />
                            </Link>
                          </td>
                          {responses.previewColumns.map((col) => (
                            <td key={col.questionId} className="truncate px-4">
                              {item.preview[col.questionId] || (
                                <span className="text-subtle-foreground">—</span>
                              )}
                            </td>
                          ))}
                          {completed ? (
                            <td className="truncate px-4">
                              {item.endingTitle ?? (
                                <span className="text-subtle-foreground">—</span>
                              )}
                            </td>
                          ) : (
                            <>
                              <td className="px-4">
                                <ProgressBar {...item.progress} />
                              </td>
                              <td className="text-muted-foreground truncate px-4">
                                {item.lastQuestionLabel ?? "—"}
                              </td>
                              <td className="px-4">
                                <ActivityChip
                                  activity={responseActivity({
                                    status: item.status,
                                    lastActiveAt: item.lastActiveAt,
                                  })}
                                />
                              </td>
                            </>
                          )}
                          <td className="relative z-10 px-2 text-right">
                            <span className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                              {!viewOnly && (
                                <DeleteResponseButton
                                  formId={formId}
                                  responseId={item.id}
                                />
                              )}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={responses.page}
                  pageCount={responses.pageCount}
                  hrefFor={(p) => href({ page: p > 1 ? String(p) : undefined })}
                  summary={`Showing ${((responses.page - 1) * PAGE_SIZE + 1).toLocaleString()}–${Math.min(
                    responses.page * PAGE_SIZE,
                    responses.totalCount,
                  ).toLocaleString()} of ${responses.totalCount.toLocaleString()}`}
                />
              </>
            ))}
        </>
      )}
    </div>
  );
}
