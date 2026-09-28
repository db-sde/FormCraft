import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getResponseDetail } from "@/domains/responses";
import { getUploadSignedUrl } from "@/domains/uploads";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { DeleteResponseButton } from "@/components/responses/delete-response-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

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

  const uploadUrls = new Map<string, string>();
  for (const answer of detail.answers) {
    if (answer.question.type === "file_upload" && typeof answer.formatted === "string") {
      const { data: upload } = await supabase
        .from("uploads")
        .select("storage_path")
        .eq("response_id", responseId)
        .eq("question_id", answer.questionId)
        .maybeSingle();
      if (upload) {
        const url = await getUploadSignedUrl(supabase, upload.storage_path);
        if (url) uploadUrls.set(answer.questionId, url);
      }
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <Link
          href={`/forms/${formId}/responses`}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-3.5" /> Back to responses
        </Link>
        <DeleteResponseButton
          formId={formId}
          responseId={responseId}
          redirectTo={`/forms/${formId}/responses`}
        />
      </div>

      <div className="mb-6 flex items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight">
          {detail.completedAt
            ? new Date(detail.completedAt).toLocaleString()
            : "In progress"}
        </h1>
        <Badge variant={detail.status === "completed" ? "default" : "secondary"}>
          {detail.status}
        </Badge>
      </div>

      {detail.endingTitle && (
        <p className="text-muted-foreground mb-6 text-sm">
          Reached ending:{" "}
          <span className="text-foreground font-medium">{detail.endingTitle}</span>
        </p>
      )}

      <div className="flex flex-col gap-3">
        {detail.answers.map((answer) => (
          <Card key={answer.questionId}>
            <CardContent className="py-4">
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {answer.label}
              </p>
              {answer.question.type === "file_upload" &&
              uploadUrls.has(answer.questionId) ? (
                <a
                  href={uploadUrls.get(answer.questionId)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm underline"
                >
                  {answer.formatted || "Download file"}
                </a>
              ) : (
                <p className="mt-0.5 text-sm break-words">
                  {answer.formatted || (
                    <span className="text-muted-foreground">No answer</span>
                  )}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
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
