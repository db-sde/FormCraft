import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronDown, ChevronUp, Download, FileText } from "lucide-react";
import {
  describeSource,
  formatDuration,
  getAdjacentResponseIds,
  getResponseDetail,
  responseActivity,
} from "@/domains/responses";
import {
  CONTACT_FIELD_LABELS,
  CONTACT_FIELDS,
} from "@/domains/forms/schema/question-types";
import { getUploadSignedUrl } from "@/domains/uploads";
import { formatValue } from "@/domains/logic/recall";
import { DeleteResponseButton } from "@/components/responses/delete-response-button";
import { ActivityChip } from "@/components/responses/activity-chip";
import { LocalTime } from "@/components/local-time";
import { cn } from "cn";
import { loadFormForPage } from "../../../load-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { form } = await loadFormForPage(id);
  return { title: `Response · ${form.title}` };
}

function contactRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === "string" && e[1].trim() !== "",
    ),
  );
}

const NAV =
  "fc-focus inline-flex h-9 items-center gap-1.5 rounded-sm border-[1.5px] px-3 text-[13.5px] font-semibold";

function NavLink({
  href,
  label,
  icon,
  children,
}: {
  href: string | null;
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  // A disabled <Link> still navigates — render an inert span instead.
  return href ? (
    <Link
      href={href}
      title={label}
      className={cn(NAV, "border-ink bg-card hover:bg-accent")}
    >
      {icon}
      <span className="max-sm:sr-only">{children}</span>
    </Link>
  ) : (
    <span
      aria-disabled
      title={label}
      className={cn(NAV, "border-disabled-border text-subtle-foreground border-dashed")}
    >
      {icon}
      <span className="max-sm:sr-only">{children}</span>
    </span>
  );
}

export default async function ResponseDetailPage({
  params,
}: {
  params: Promise<{ id: string; responseId: string }>;
}) {
  const { id: formId, responseId } = await params;
  const { supabase, form } = await loadFormForPage(formId);

  const detail = await getResponseDetail(supabase, responseId);
  if (!detail || detail.formId !== formId) notFound();

  const completed = detail.status === "completed";
  const activity = responseActivity(detail);
  const adjacent = await getAdjacentResponseIds(supabase, formId, detail);

  // Show the respondent's original file name, not the internal upload
  // reference the answer value stores.
  const uploads = new Map<
    string,
    { url: string | null; name: string; size: number | null }
  >();
  const fileQuestionIds = detail.answers
    .filter((a) => a.question.type === "file_upload" && a.formatted)
    .map((a) => a.questionId);
  if (fileQuestionIds.length > 0) {
    const { data: rows } = await supabase
      .from("uploads")
      .select("question_id, storage_path, original_filename, size_bytes")
      .eq("response_id", responseId)
      .in("question_id", fileQuestionIds);
    for (const row of rows ?? []) {
      uploads.set(row.question_id, {
        url: await getUploadSignedUrl(supabase, row.storage_path),
        name: row.original_filename,
        size: row.size_bytes,
      });
    }
  }

  const listHref = `/forms/${formId}/responses${completed ? "" : "?view=incomplete"}`;
  const detailHref = (id: string | null) =>
    id ? `/forms/${formId}/responses/${id}` : null;
  const contactAnswer = detail.answers.find(
    (a) => a.question.type === "contact_info" && a.formatted,
  );
  const who = contactAnswer ? contactRecord(contactAnswer.value).name : undefined;
  const answeredCount = detail.answers.filter((a) => a.formatted).length;
  const endedAt = completed
    ? (detail.completedAt ?? detail.lastActiveAt)
    : detail.lastActiveAt;
  const source = describeSource({
    utmSource: detail.utmSource,
    referrer: detail.referrer,
  });
  const utm = (
    [
      ["Referrer", detail.referrer],
      ["UTM source", detail.utmSource],
      ["UTM medium", detail.utmMedium],
      ["UTM campaign", detail.utmCampaign],
      ["UTM term", detail.utmTerm],
      ["UTM content", detail.utmContent],
    ] as const
  ).filter(([, value]) => value);

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-5">
      <div className="flex items-center gap-2.5">
        <Link
          href={listHref}
          className="text-muted-foreground hover:text-foreground flex min-w-0 items-center gap-1.5 text-sm font-semibold"
        >
          <ArrowLeft className="size-4 shrink-0" />
          <span className="truncate">{form.title}</span>
        </Link>
        <span className="flex-1" />
        <NavLink
          href={detailHref(adjacent.newerId)}
          label="Newer response"
          icon={<ChevronUp className="size-3.5" />}
        >
          Newer
        </NavLink>
        <NavLink
          href={detailHref(adjacent.olderId)}
          label="Older response"
          icon={<ChevronDown className="size-3.5" />}
        >
          Older
        </NavLink>
        <DeleteResponseButton
          formId={formId}
          responseId={responseId}
          redirectTo={listHref}
          who={who}
          variant="outline"
        />
      </div>

      <div className="border-ink flex flex-col gap-2.5 border-b-[1.5px] pb-[18px]">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-[30px] leading-[1.05] font-bold tracking-[-0.03em] sm:text-[40px] sm:leading-none">
            {completed ? <LocalTime iso={endedAt} /> : "Not submitted yet"}
          </h1>
          <span className="-rotate-3">
            <ActivityChip activity={activity} size="default" />
          </span>
        </div>
        <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {completed ? (
            detail.endingTitle && (
              <span>
                Reached ending: <b className="text-foreground">{detail.endingTitle}</b>
              </span>
            )
          ) : (
            <span>
              Last active <LocalTime iso={detail.lastActiveAt} variant="relative" /> ·
              answered {answeredCount} of {detail.answers.length}
              {detail.lastQuestionLabel && (
                <>
                  {" "}
                  · stopped at{" "}
                  <b className="text-foreground">{detail.lastQuestionLabel}</b>
                </>
              )}
            </span>
          )}
          <span>Took {formatDuration(detail.startedAt, endedAt)}</span>
          <span>Source: {source}</span>
        </div>
      </div>

      {(Object.keys(detail.results.variables).length > 0 ||
        Object.keys(detail.results.hidden).length > 0) && (
        <section className="border-ink bg-card rounded-lg border-[1.5px] px-[18px] py-4">
          <h2 className="text-muted-foreground mb-2.5 text-[11.5px] font-bold tracking-[0.1em] uppercase">
            Results
          </h2>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
            {Object.entries(detail.results.variables).map(([name, value]) => (
              <div key={name} className="flex min-w-0 flex-col">
                <dt className="text-muted-foreground font-mono text-xs">{name}</dt>
                <dd className="font-heading truncate text-xl font-bold">
                  {formatValue(value) || "—"}
                </dd>
              </div>
            ))}
            {Object.entries(detail.results.hidden).map(([name, value]) => (
              <div key={`h-${name}`} className="flex min-w-0 flex-col">
                <dt className="text-muted-foreground font-mono text-xs">{name} (URL)</dt>
                <dd className="truncate text-[15px] font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <div className="grid gap-3.5 md:grid-cols-2">
        {detail.answers.map((answer, index) => {
          const upload = uploads.get(answer.questionId);
          const wide =
            answer.question.type === "long_text" ||
            answer.question.type === "contact_info" ||
            answer.question.type === "file_upload" ||
            answer.formatted.length > 60;
          const contact =
            answer.question.type === "contact_info" ? contactRecord(answer.value) : null;
          return (
            <section
              key={answer.questionId}
              className={cn(
                "border-border bg-card flex min-w-0 flex-col gap-2 rounded-lg border-[1.5px] px-[18px] py-4",
                wide && "md:col-span-2",
              )}
            >
              <h2 className="text-muted-foreground flex gap-2 text-[13px] font-normal">
                <b className="text-foreground">{index + 1}</b>
                <span className="min-w-0">{answer.label}</span>
              </h2>
              {upload ? (
                <a
                  href={upload.url ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    "border-ink bg-background flex items-center gap-2.5 self-start rounded-[8px] border-[1.5px] py-2 pr-3 pl-2",
                    !upload.url && "pointer-events-none",
                  )}
                >
                  <span className="grid size-8 place-items-center rounded-[6px] bg-[var(--qt-other-bg)] text-[var(--qt-other-fg)]">
                    <FileText className="size-4" />
                  </span>
                  <span className="flex flex-col leading-tight">
                    <b className="text-sm">{upload.name}</b>
                    <span className="text-muted-foreground text-xs">
                      {upload.size
                        ? `${Math.max(1, Math.round(upload.size / 1024))} KB · `
                        : ""}
                      {upload.url ? "click to download" : "file unavailable"}
                    </span>
                  </span>
                  {upload.url && <Download className="ml-2 size-4" />}
                </a>
              ) : contact && Object.keys(contact).length > 0 ? (
                <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                  {CONTACT_FIELDS.filter((f) => contact[f]).map((field) => (
                    <div key={field} className="flex min-w-0 flex-col">
                      <dt className="text-muted-foreground text-xs">
                        {CONTACT_FIELD_LABELS[field]}
                      </dt>
                      <dd className="truncate text-[17px] font-semibold">
                        {field === "email" ? (
                          <a
                            href={`mailto:${contact[field]}`}
                            className="hover:underline"
                          >
                            {contact[field]}
                          </a>
                        ) : field === "phone" ? (
                          <a href={`tel:${contact[field]}`} className="hover:underline">
                            {contact[field]}
                          </a>
                        ) : (
                          contact[field]
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : answer.formatted ? (
                // pre-wrap: long-text answers keep their line breaks.
                <p className="text-[17px] leading-[1.45] font-semibold break-words whitespace-pre-wrap">
                  {answer.formatted}
                </p>
              ) : (
                <p className="text-subtle-foreground text-[17px] leading-[1.45] font-semibold italic">
                  {completed ? "Skipped" : "Not answered yet"}
                </p>
              )}
            </section>
          );
        })}
      </div>

      {utm.length > 0 && (
        <dl className="text-muted-foreground grid gap-1 text-xs sm:grid-cols-2">
          {utm.map(([label, value]) => (
            <div key={label} className="truncate">
              <dt className="inline">{label}: </dt>
              <dd className="inline">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
