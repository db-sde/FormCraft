import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, Inbox } from "lucide-react";
import { listResponses, getResponseCounts } from "@/domains/responses";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { DeleteResponseButton } from "@/components/responses/delete-response-button";
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
  const [responses, counts] = await Promise.all([
    listResponses(supabase, formId, { page }),
    getResponseCounts(supabase, formId),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-2 flex items-center gap-2 text-sm">
        <Link
          href={`/forms/${formId}`}
          className="text-muted-foreground hover:text-foreground"
        >
          {form.title}
        </Link>
        <span className="text-muted-foreground">/</span>
        <span>Responses</span>
      </div>

      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {counts.completed} response{counts.completed === 1 ? "" : "s"}
          </h1>
          {(counts.partial > 0 || counts.inProgress > 0) && (
            <p className="text-muted-foreground text-sm">
              Plus {counts.partial + counts.inProgress} in-progress/partial session
              {counts.partial + counts.inProgress === 1 ? "" : "s"}, not shown below.
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

      {responses.items.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Inbox className="text-muted-foreground size-8" />
            <p className="font-medium">No responses yet</p>
            <p className="text-muted-foreground max-w-sm text-sm">
              Once people start submitting your published form, their responses will show
              up here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Ending</TableHead>
                  <TableHead className="w-1" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {responses.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Link
                        href={`/forms/${formId}/responses/${item.id}`}
                        className="hover:underline"
                      >
                        {item.completedAt
                          ? new Date(item.completedAt).toLocaleString()
                          : "—"}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {item.endingTitle ? (
                        item.endingTitle
                      ) : (
                        <Badge variant="secondary">Unknown</Badge>
                      )}
                    </TableCell>
                    <TableCell>
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
                <Button asChild variant="outline" size="sm" disabled={page <= 1}>
                  <Link href={`/forms/${formId}/responses?page=${page - 1}`}>
                    Previous
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  disabled={page >= responses.pageCount}
                >
                  <Link href={`/forms/${formId}/responses?page=${page + 1}`}>Next</Link>
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
