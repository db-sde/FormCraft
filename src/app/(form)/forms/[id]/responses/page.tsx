import Link from "next/link";
import {
  CheckCircle2,
  Download,
  Hourglass,
  Inbox,
  MousePointerClick,
  Percent,
} from "lucide-react";
import {
  ACTIVITY_LABEL,
  getDropoff,
  getResponseCounts,
  listResponses,
  responseActivity,
  type DropoffStep,
  type ResponseView,
} from "@/domains/responses";
import { getFunnelSummaryForForm } from "@/domains/analytics";
import { DeleteResponseButton } from "@/components/responses/delete-response-button";
import { FormTopBar, FormTitle } from "@/components/forms/form-top-bar";
import { FormStatusBadge } from "@/components/forms/form-status-badge";
import { FormPageActions } from "@/components/forms/form-page-actions";
import { CopyLinkButton } from "@/components/forms/live-link-actions";
import { PublishButton } from "@/components/forms/publish-button";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Pagination } from "@/components/shared/pagination";
import { ViewSwitch } from "@/components/shared/view-switch";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LocalTime } from "@/components/local-time";
import { loadFormForPage } from "../load-form";
import { ABANDONED_AFTER_MINUTES } from "@/domains/responses/activity";
import { cn } from "cn";

function ActivityPill({
  status,
  lastActiveAt,
}: {
  status: string;
  lastActiveAt: string;
}) {
  const activity = responseActivity({ status, lastActiveAt });
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        activity === "in_progress"
          ? "bg-sky-50 text-sky-700"
          : activity === "abandoned"
            ? "bg-amber-50 text-amber-700"
            : "bg-emerald-50 text-emerald-700",
      )}
    >
      {ACTIVITY_LABEL[activity]}
    </span>
  );
}

/** Where abandoned respondents stopped, question by question. */
function DropoffCard({ steps, total }: { steps: DropoffStep[]; total: number }) {
  if (total === 0) return null;
  const max = Math.max(...steps.map((s) => s.stopped));
  return (
    <div className="bg-card mb-6 rounded-xl border p-5 shadow-xs">
      <p className="font-medium">Where people drop off</p>
      <p className="text-muted-foreground mb-4 text-sm">
        The last question {total} abandoned respondent{total === 1 ? "" : "s"} saw before
        leaving (inactive {ABANDONED_AFTER_MINUTES}+ minutes).
      </p>
      <ol className="space-y-2.5">
        {steps.map((step, i) => (
          <li
            key={step.questionId}
            className="grid grid-cols-[1.5rem_1fr_auto] items-center gap-3 text-sm"
          >
            <span className="text-muted-foreground tabular-nums">{i + 1}</span>
            <div className="min-w-0">
              <p className="truncate">{step.label}</p>
              <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full">
                <div
                  className={cn(
                    "h-full rounded-full",
                    step.stopped === max ? "bg-amber-500" : "bg-primary/60",
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
    </div>
  );
}

function ProgressBar({ answered, total }: { answered: number; total: number }) {
  const percent = total === 0 ? 0 : Math.round((answered / total) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="bg-muted h-1.5 w-20 overflow-hidden rounded-full">
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
  searchParams: Promise<{ page?: string; view?: string }>;
}) {
  const { id: formId } = await params;
  const { page: pageParam, view: viewParam } = await searchParams;
  const { supabase, form, isLive } = await loadFormForPage(formId);
  const view: ResponseView = viewParam === "incomplete" ? "incomplete" : "completed";

  const page = Math.max(1, Number(pageParam) || 1);
  const [responses, counts, funnel, dropoff] = await Promise.all([
    listResponses(supabase, formId, { page, view }),
    getResponseCounts(supabase, formId),
    getFunnelSummaryForForm(supabase, formId),
    view === "incomplete" ? getDropoff(supabase, formId) : null,
  ]);

  const base = `/forms/${formId}/responses`;
  const hrefFor = (p: number) => `${base}?view=${view}&page=${p}`;
  const completed = view === "completed";

  return (
    <>
      <FormTopBar
        formId={formId}
        active="responses"
        title={
          <>
            <FormTitle>{form.title}</FormTitle>
            <FormStatusBadge live={isLive} />
          </>
        }
        actions={<FormPageActions formId={formId} slug={form.slug} isLive={isLive} />}
      />

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Views"
            value={funnel.views}
            icon={MousePointerClick}
            hint="Times the form was opened"
          />
          <StatCard
            label="Started"
            value={funnel.starts}
            icon={Hourglass}
            hint="Began answering"
          />
          <StatCard
            label="Completed"
            value={counts.completed}
            icon={CheckCircle2}
            hint="Submitted the form"
          />
          <StatCard
            label="Completion rate"
            value={
              funnel.completionRate === null
                ? "—"
                : `${Math.round(funnel.completionRate)}%`
            }
            icon={Percent}
            hint="Completed ÷ started"
          />
        </div>

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <ViewSwitch
            label="Which responses"
            active={view}
            options={[
              {
                id: "completed",
                label: "Completed",
                count: counts.completed,
                href: `${base}?view=completed`,
              },
              {
                id: "incomplete",
                label: "Incomplete",
                count: counts.partial,
                href: `${base}?view=incomplete`,
              },
            ]}
          />
          {responses.totalCount > 0 && (
            <Button asChild variant="outline">
              <a href={`/api/forms/${formId}/export.csv?view=${view}`} download>
                <Download />
                Export CSV
              </a>
            </Button>
          )}
        </div>

        {!completed && (
          <>
            <p className="text-muted-foreground mb-4 text-sm">
              People who answered at least one question but didn&apos;t submit. Answers
              are saved as they go, so you see everything they entered — including contact
              details if they got past your lead capture step.{" "}
              <strong className="text-foreground font-medium">In progress</strong> means
              active in the last {ABANDONED_AFTER_MINUTES} minutes;{" "}
              <strong className="text-foreground font-medium">Abandoned</strong> means
              they&apos;ve gone quiet since.
            </p>
            {dropoff && <DropoffCard {...dropoff} />}
          </>
        )}

        {responses.items.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={completed ? "No completed responses yet" : "No incomplete responses"}
            description={
              !isLive
                ? "This form isn't published yet, so nobody can respond. Publish it to get a shareable link."
                : completed
                  ? "Share your form's link — submissions will appear here as they come in."
                  : "Everyone who started this form either finished it or hasn't answered anything yet."
            }
            actions={
              !isLive ? (
                <PublishButton formId={formId} />
              ) : completed ? (
                <>
                  <CopyLinkButton
                    slug={form.slug}
                    label="Copy form link"
                    variant="default"
                  />
                  <Button asChild variant="outline">
                    <Link href={`/forms/${formId}/share`}>More ways to share</Link>
                  </Button>
                </>
              ) : null
            }
          />
        ) : (
          <>
            <div className="bg-card overflow-x-auto rounded-xl border shadow-xs">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">
                      {completed ? "Submitted" : "Last active"}
                    </TableHead>
                    {responses.previewColumns.map((col) => (
                      <TableHead key={col.questionId} className="max-w-56">
                        <span className="line-clamp-1">{col.label}</span>
                      </TableHead>
                    ))}
                    <TableHead className="whitespace-nowrap">
                      {completed ? "Ending" : "Progress"}
                    </TableHead>
                    {!completed && (
                      <TableHead className="whitespace-nowrap">Stopped at</TableHead>
                    )}
                    {!completed && <TableHead>Status</TableHead>}
                    <TableHead className="hidden xl:table-cell">Source</TableHead>
                    <TableHead className="w-1">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {responses.items.map((item) => (
                    <TableRow key={item.id} className="hover:bg-muted/40 relative">
                      <TableCell className="whitespace-nowrap">
                        {/* ::after stretches this link over the whole row;
                            the delete button sits above it (z-10). */}
                        <Link
                          href={`${base}/${item.id}`}
                          className="font-medium after:absolute after:inset-0 after:content-['']"
                        >
                          <LocalTime
                            iso={
                              completed
                                ? (item.completedAt ?? item.lastActiveAt)
                                : item.lastActiveAt
                            }
                          />
                        </Link>
                      </TableCell>
                      {responses.previewColumns.map((col) => (
                        <TableCell key={col.questionId} className="max-w-56">
                          <span className="line-clamp-1">
                            {item.preview[col.questionId] || (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </span>
                        </TableCell>
                      ))}
                      <TableCell className="whitespace-nowrap">
                        {completed ? (
                          (item.endingTitle ?? (
                            <span className="text-muted-foreground">—</span>
                          ))
                        ) : (
                          <ProgressBar {...item.progress} />
                        )}
                      </TableCell>
                      {!completed && (
                        <TableCell className="max-w-48">
                          <span className="text-muted-foreground line-clamp-1">
                            {item.lastQuestionLabel ?? "—"}
                          </span>
                        </TableCell>
                      )}
                      {!completed && (
                        <TableCell>
                          <ActivityPill
                            status={item.status}
                            lastActiveAt={item.lastActiveAt}
                          />
                        </TableCell>
                      )}
                      <TableCell className="text-muted-foreground hidden max-w-32 xl:table-cell">
                        <span className="line-clamp-1">{item.source}</span>
                      </TableCell>
                      <TableCell className="relative z-10">
                        <DeleteResponseButton formId={formId} responseId={item.id} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination
              page={responses.page}
              pageCount={responses.pageCount}
              hrefFor={hrefFor}
            />
          </>
        )}
      </main>
    </>
  );
}
