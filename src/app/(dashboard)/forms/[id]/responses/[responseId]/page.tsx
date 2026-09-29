import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, Paperclip } from "lucide-react";
import { getResponseDetail, getAdjacentResponseIds } from "@/domains/responses";
import { getUploadSignedUrl } from "@/domains/uploads";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { DeleteResponseButton } from "@/components/responses/delete-response-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LocalTime } from "@/components/local-time";

const STATUS_LABEL: Record<string, string> = {
  completed: "Completed",
  partial: "Partial",
  in_progress: "In progress",
};

export default async function ResponseDetailPage({
  params,
}: {
  params: Promise<{ id: string; responseId: string }>;
}) {
  const { id: formId, responseId } = await params;
  const { supabase, workspace } = await getCurrentWorkspace();

  const { data: form } = await supabase
    .from("forms")
    .select("id, title")
    .eq("id", formId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!form) notFound();

  const detail = await getResponseDetail(supabase, responseId);
  if (!detail || detail.formId !== formId) notFound();

  const adjacent = detail.completedAt
    ? await getAdjacentResponseIds(supabase, formId, detail.completedAt)
    : { newerId: null, olderId: null };

  // Show the respondent's original file name, not the internal upload
  // reference the answer value stores.
  const uploads = new Map<string, { url: string | null; name: string }>();
  const fileQuestionIds = detail.answers
    .filter((a) => a.question.type === "file_upload" && a.formatted)
    .map((a) => a.questionId);
  if (fileQuestionIds.length > 0) {
    const { data: rows } = await supabase
      .from("uploads")
      .select("question_id, storage_path, original_filename")
      .eq("response_id", responseId)
      .in("question_id", fileQuestionIds);
    for (const row of rows ?? []) {
      uploads.set(row.question_id, {
        url: await getUploadSignedUrl(supabase, row.storage_path),
        name: row.original_filename,
      });
    }
  }

  const base = `/forms/${formId}/responses`;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-6 flex items-center justify-between gap-2">
        <Link
          href={base}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-3.5" /> {form.title}
        </Link>
        <div className="flex items-center gap-1">
          {adjacent.newerId ? (
            <Button asChild variant="ghost" size="icon-sm" aria-label="Newer response">
              <Link href={`${base}/${adjacent.newerId}`}>
                <ChevronLeft />
              </Link>
            </Button>
          ) : (
            <Button variant="ghost" size="icon-sm" aria-label="Newer response" disabled>
              <ChevronLeft />
            </Button>
          )}
          {adjacent.olderId ? (
            <Button asChild variant="ghost" size="icon-sm" aria-label="Older response">
              <Link href={`${base}/${adjacent.olderId}`}>
                <ChevronRight />
              </Link>
            </Button>
          ) : (
            <Button variant="ghost" size="icon-sm" aria-label="Older response" disabled>
              <ChevronRight />
            </Button>
          )}
          <DeleteResponseButton
            formId={formId}
            responseId={responseId}
            redirectTo={base}
          />
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight">
          {detail.completedAt ? (
            <LocalTime iso={detail.completedAt} />
          ) : (
            "Not submitted yet"
          )}
        </h1>
        <Badge variant={detail.status === "completed" ? "default" : "secondary"}>
          {STATUS_LABEL[detail.status] ?? detail.status}
        </Badge>
      </div>

      {detail.endingTitle && (
        <p className="text-muted-foreground mb-6 text-sm">
          Reached ending:{" "}
          <span className="text-foreground font-medium">{detail.endingTitle}</span>
        </p>
      )}

      <div className="flex flex-col gap-3">
        {detail.answers.map((answer) => {
          const upload = uploads.get(answer.questionId);
          return (
            <Card key={answer.questionId}>
              <CardContent className="py-4">
                <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {answer.label}
                </p>
                {upload ? (
                  upload.url ? (
                    <a
                      href={upload.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1.5 text-sm underline"
                    >
                      <Paperclip className="size-3.5" /> {upload.name}
                    </a>
                  ) : (
                    <p className="mt-1 text-sm">{upload.name}</p>
                  )
                ) : (
                  // pre-wrap: long-text answers keep their line breaks.
                  <p className="mt-0.5 text-sm break-words whitespace-pre-wrap">
                    {answer.formatted || (
                      <span className="text-muted-foreground">No answer</span>
                    )}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {(detail.referrer || detail.utmSource) && (
        <div className="text-muted-foreground mt-8 space-y-1 text-xs">
          {detail.referrer && <p>Referrer: {detail.referrer}</p>}
          {detail.utmSource && (
            <p>
              UTM: {detail.utmSource}
              {detail.utmMedium ? ` / ${detail.utmMedium}` : ""}
              {detail.utmCampaign ? ` / ${detail.utmCampaign}` : ""}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
