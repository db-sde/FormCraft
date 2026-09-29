import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, Inbox } from "lucide-react";
import { listResponses, getResponseCounts } from "@/domains/responses";
import { getPublishInfo } from "@/domains/forms";
import { listAnalyticsEventsForForm, computeFunnelSummary } from "@/domains/analytics";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { DeleteResponseButton } from "@/components/responses/delete-response-button";
import { FormTabs } from "@/components/forms/form-tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: string;
}) {
  // A disabled <Link> is still a working link — render an inert button
  // instead, so "Previous" on page 1 can't navigate to page 0.
  return disabled ? (
    <Button variant="outline" size="sm" disabled>
      {children}
    </Button>
  ) : (
    <Button asChild variant="outline" size="sm">
      <Link href={href}>{children}</Link>
    </Button>
  );
}

export default async function ResponsesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id: formId } = await params;
  const { page: pageParam } = await searchParams;
  const { supabase, workspace } = await getCurrentWorkspace();

  const { data: form } = await supabase
    .from("forms")
    .select("id, title")
    .eq("id", formId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!form) notFound();

  const page = Math.max(1, Number(pageParam) || 1);
  const [responses, counts, analyticsEvents, publishInfo] = await Promise.all([
    listResponses(supabase, formId, { page }),
    getResponseCounts(supabase, formId),
    listAnalyticsEventsForForm(supabase, formId),
    getPublishInfo(supabase, formId),
  ]);
  const funnel = computeFunnelSummary(analyticsEvents);
  const inProgress = counts.partial + counts.inProgress;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight">
          {form.title}
        </h1>
        <FormTabs formId={formId} active="responses" />
      </div>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {counts.completed} response{counts.completed === 1 ? "" : "s"}
          </h2>
          {inProgress > 0 && (
            <p className="text-muted-foreground text-sm">
              Plus {inProgress} unfinished session{inProgress === 1 ? "" : "s"}, not shown
              below.
            </p>
          )}
        </div>
        {counts.completed > 0 && (
          <Button asChild variant="outline">
            <a href={`/api/forms/${formId}/export.csv`}>
              <Download /> Export CSV
            </a>
          </Button>
        )}
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Views", value: String(funnel.views) },
          { label: "Starts", value: String(funnel.starts) },
          { label: "Completions", value: String(funnel.completions) },
          {
            label: "Completion rate",
            value:
              funnel.completionRate === null
                ? "—"
                : `${funnel.completionRate.toFixed(0)}%`,
          },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="py-4">
              <p className="text-muted-foreground text-xs">{stat.label}</p>
              <p className="text-xl font-semibold tabular-nums">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {responses.items.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Inbox className="text-muted-foreground size-8" />
            <p className="font-medium">No responses yet</p>
            {publishInfo?.isPublished ? (
              <p className="text-muted-foreground max-w-sm text-sm">
                Your form is live. Share its link and responses will show up here as
                people submit.
              </p>
            ) : (
              <>
                <p className="text-muted-foreground max-w-sm text-sm">
                  This form isn&apos;t published yet, so nobody can respond to it.
                </p>
                <Button asChild size="sm" className="mt-1">
                  <Link href={`/forms/${formId}`}>Open the builder to publish</Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">Submitted</TableHead>
                  {responses.previewColumns.map((col) => (
                    <TableHead key={col.questionId} className="max-w-48">
                      <span className="line-clamp-1">{col.label}</span>
                    </TableHead>
                  ))}
                  <TableHead>Ending</TableHead>
                  <TableHead className="w-1">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {responses.items.map((item) => (
                  <TableRow key={item.id} className="hover:bg-muted/40 relative">
                    <TableCell className="whitespace-nowrap">
                      {/* ::after stretches this link over the whole row,
                          so any cell opens the response; the delete
                          button sits above it (z-10). */}
                      <Link
                        href={`/forms/${formId}/responses/${item.id}`}
                        className="after:absolute after:inset-0 after:content-['']"
                      >
                        {item.completedAt
                          ? new Date(item.completedAt).toLocaleString()
                          : "—"}
                      </Link>
                    </TableCell>
                    {responses.previewColumns.map((col) => (
                      <TableCell key={col.questionId} className="max-w-48">
                        <span className="line-clamp-1">
                          {item.preview[col.questionId] || (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </span>
                      </TableCell>
                    ))}
                    <TableCell className="whitespace-nowrap">
                      {item.endingTitle ? (
                        item.endingTitle
                      ) : (
                        <Badge variant="secondary">Unknown</Badge>
                      )}
                    </TableCell>
                    <TableCell className="relative z-10">
                      <DeleteResponseButton formId={formId} responseId={item.id} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {responses.pageCount > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Page {responses.page} of {responses.pageCount}
              </span>
              <div className="flex gap-2">
                <PageLink
                  href={`/forms/${formId}/responses?page=${page - 1}`}
                  disabled={page <= 1}
                >
                  Previous
                </PageLink>
                <PageLink
                  href={`/forms/${formId}/responses?page=${page + 1}`}
                  disabled={page >= responses.pageCount}
                >
                  Next
                </PageLink>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
