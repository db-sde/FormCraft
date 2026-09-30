import Link from "next/link";
import {
  CheckCircle2,
  Download,
  Hourglass,
  Inbox,
  MousePointerClick,
  Percent,
} from "lucide-react";
import { listResponses, getResponseCounts, type ResponseView } from "@/domains/responses";
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
  const [responses, counts, funnel] = await Promise.all([
    listResponses(supabase, formId, { page, view }),
    getResponseCounts(supabase, formId),
    getFunnelSummaryForForm(supabase, formId),
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
          <p className="text-muted-foreground mb-4 text-sm">
            People who answered at least one question but didn&apos;t submit. Answers are
            saved as they go, so you still see everything they entered — including their
            contact details if they got past your lead capture step.
          </p>
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
