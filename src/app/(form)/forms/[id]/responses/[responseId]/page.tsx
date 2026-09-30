import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  ChevronLeft,
  ChevronRight,
  Mail,
  Paperclip,
  Phone,
  UserRound,
} from "lucide-react";
import {
  ACTIVITY_LABEL,
  describeSource,
  formatDuration,
  getAdjacentResponseIds,
  getResponseDetail,
  responseActivity,
} from "@/domains/responses";
import { getUploadSignedUrl } from "@/domains/uploads";
import { DeleteResponseButton } from "@/components/responses/delete-response-button";
import { FormTopBar, FormTitle } from "@/components/forms/form-top-bar";
import { FormStatusBadge } from "@/components/forms/form-status-badge";
import { FormPageActions } from "@/components/forms/form-page-actions";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/local-time";
import { cn } from "cn";
import { loadFormForPage } from "../../load-form";

function contactFields(value: unknown) {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const get = (k: string) => (typeof record[k] === "string" ? (record[k] as string) : "");
  return {
    name: get("name"),
    email: get("email"),
    phone: get("phone"),
    company: get("company"),
  };
}

function NavButton({
  href,
  label,
  children,
}: {
  href: string | null;
  label: string;
  children: React.ReactNode;
}) {
  return href ? (
    <Button asChild variant="outline" size="icon-sm" aria-label={label}>
      <Link href={href}>{children}</Link>
    </Button>
  ) : (
    <Button variant="outline" size="icon-sm" aria-label={label} disabled>
      {children}
    </Button>
  );
}

export default async function ResponseDetailPage({
  params,
}: {
  params: Promise<{ id: string; responseId: string }>;
}) {
  const { id: formId, responseId } = await params;
  const { supabase, form, isLive, publishState } = await loadFormForPage(formId);

  const detail = await getResponseDetail(supabase, responseId);
  if (!detail || detail.formId !== formId) notFound();

  const completed = detail.status === "completed";
  const activity = responseActivity(detail);
  const adjacent = await getAdjacentResponseIds(supabase, formId, detail);

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

  const listHref = `/forms/${formId}/responses?view=${completed ? "completed" : "incomplete"}`;
  const detailHref = (id: string | null) =>
    id ? `/forms/${formId}/responses/${id}` : null;
  const contactAnswer = detail.answers.find(
    (a) => a.question.type === "contact_info" && a.formatted,
  );
  const contact = contactAnswer ? contactFields(contactAnswer.value) : null;
  const answeredCount = detail.answers.filter((a) => a.formatted).length;

  return (
    <>
      <FormTopBar
        formId={formId}
        active="responses"
        title={
          <>
            <FormTitle>{form.title}</FormTitle>
            <FormStatusBadge state={publishState} />
          </>
        }
        actions={<FormPageActions formId={formId} slug={form.slug} isLive={isLive} />}
      />

      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8 sm:py-8">
        <div className="mb-6 flex items-center justify-between gap-2">
          <Link
            href={listHref}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm"
          >
            <ArrowLeft className="size-4" />
            {completed ? "Completed responses" : "Incomplete responses"}
          </Link>
          <div className="flex items-center gap-1.5">
            <NavButton href={detailHref(adjacent.newerId)} label="Newer response">
              <ChevronLeft />
            </NavButton>
            <NavButton href={detailHref(adjacent.olderId)} label="Older response">
              <ChevronRight />
            </NavButton>
            <DeleteResponseButton
              formId={formId}
              responseId={responseId}
              redirectTo={listHref}
            />
          </div>
        </div>

        <div className="bg-card mb-4 rounded-xl border p-5 shadow-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                activity === "completed"
                  ? "bg-emerald-50 text-emerald-700"
                  : activity === "in_progress"
                    ? "bg-sky-50 text-sky-700"
                    : "bg-amber-50 text-amber-700",
              )}
            >
              {ACTIVITY_LABEL[activity]}
            </span>
            <span className="text-muted-foreground text-sm">
              {completed ? (
                detail.endingTitle && (
                  <>
                    Reached ending{" "}
                    <span className="text-foreground font-medium">
                      {detail.endingTitle}
                    </span>
                  </>
                )
              ) : (
                <>
                  Answered {answeredCount} of {detail.answers.length} questions
                  {detail.lastQuestionLabel && (
                    <>
                      {" "}
                      — stopped at{" "}
                      <span className="text-foreground font-medium">
                        {detail.lastQuestionLabel}
                      </span>
                    </>
                  )}
                </>
              )}
            </span>
          </div>
          <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground text-xs">Started</dt>
              <dd>
                <LocalTime iso={detail.startedAt} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">
                {completed ? "Submitted" : "Last active"}
              </dt>
              <dd>
                <LocalTime
                  iso={
                    completed
                      ? (detail.completedAt ?? detail.lastActiveAt)
                      : detail.lastActiveAt
                  }
                />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Time spent</dt>
              <dd>
                {formatDuration(
                  detail.startedAt,
                  completed
                    ? (detail.completedAt ?? detail.lastActiveAt)
                    : detail.lastActiveAt,
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Source</dt>
              <dd className="truncate">
                {describeSource({
                  utmSource: detail.utmSource,
                  referrer: detail.referrer,
                })}
              </dd>
            </div>
          </dl>
        </div>

        {contact && (
          <div className="border-primary/20 bg-accent/50 mb-4 rounded-xl border p-5">
            <p className="text-accent-foreground mb-3 text-xs font-semibold tracking-wide uppercase">
              Lead
            </p>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              {contact.name && (
                <span className="flex items-center gap-2">
                  <UserRound className="text-muted-foreground size-4" />
                  {contact.name}
                </span>
              )}
              {contact.email && (
                <a
                  href={`mailto:${contact.email}`}
                  className="flex items-center gap-2 hover:underline"
                >
                  <Mail className="text-muted-foreground size-4" />
                  {contact.email}
                </a>
              )}
              {contact.phone && (
                <a
                  href={`tel:${contact.phone}`}
                  className="flex items-center gap-2 hover:underline"
                >
                  <Phone className="text-muted-foreground size-4" />
                  {contact.phone}
                </a>
              )}
              {contact.company && (
                <span className="flex items-center gap-2">
                  <Building2 className="text-muted-foreground size-4" />
                  {contact.company}
                </span>
              )}
            </div>
          </div>
        )}

        <div className="bg-card divide-y rounded-xl border shadow-xs">
          {detail.answers.map((answer, index) => {
            const upload = uploads.get(answer.questionId);
            return (
              <div key={answer.questionId} className="flex gap-4 p-5">
                <span className="text-muted-foreground w-5 shrink-0 text-sm tabular-nums">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-muted-foreground text-sm">{answer.label}</p>
                  {upload ? (
                    upload.url ? (
                      <a
                        href={upload.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1.5 font-medium underline"
                      >
                        <Paperclip className="size-3.5" /> {upload.name}
                      </a>
                    ) : (
                      <p className="mt-1 font-medium">{upload.name}</p>
                    )
                  ) : (
                    // pre-wrap: long-text answers keep their line breaks.
                    <p className="mt-1 font-medium break-words whitespace-pre-wrap">
                      {answer.formatted || (
                        <span className="text-muted-foreground font-normal italic">
                          {completed ? "Skipped" : "Not answered yet"}
                        </span>
                      )}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {(detail.referrer || detail.utmSource || detail.utmCampaign) && (
          <dl className="text-muted-foreground mt-6 grid gap-1 text-xs sm:grid-cols-2">
            {detail.referrer && (
              <div className="truncate">
                <dt className="inline">Referrer: </dt>
                <dd className="inline">{detail.referrer}</dd>
              </div>
            )}
            {(
              [
                ["UTM source", detail.utmSource],
                ["UTM medium", detail.utmMedium],
                ["UTM campaign", detail.utmCampaign],
                ["UTM term", detail.utmTerm],
                ["UTM content", detail.utmContent],
              ] as const
            )
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label} className="truncate">
                  <dt className="inline">{label}: </dt>
                  <dd className="inline">{value}</dd>
                </div>
              ))}
          </dl>
        )}
      </main>
    </>
  );
}
