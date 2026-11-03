import { formatAmount, PROVIDER_LABEL } from "@/domains/payments/config";
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
import { ResponseInsightCard } from "@/components/responses/ai-insights-panel";
import { insightsFor } from "@/domains/responses/ai-insights";
import { aiConfigured } from "@/domains/ai/config";
import { ActivityChip } from "@/components/responses/activity-chip";
import { LocalTime } from "@/components/local-time";
import { cn } from "cn";
import { getResponseTimeline } from "@/domains/responses/timeline";
import { getOrder } from "@/domains/responses/orders";
import { formatMoney } from "@/domains/forms/products";
import { documentApplies, listFormDocuments } from "@/domains/documents/issue";
import {
  DOCUMENT_KIND_LABEL,
  documentNumber,
  type DocumentKind,
} from "@/domains/documents/settings";
import { loadResponseContext } from "@/domains/responses/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { assignableMembers, listComments } from "@/domains/responses/records";
import { hasPermission } from "@/domains/workspaces/permissions";
import {
  RecordControls,
  ResponseComments,
  ResponseTimeline,
} from "@/components/responses/record-panel";
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
  const { supabase, form, viewOnly, workspace } = await loadFormForPage(formId);
  const { data: payment } = await supabase
    .from("payments")
    .select(
      "amount, currency, status, livemode, provider, discount, coupon_code, refunded_amount, provider_payment_id",
    )
    .eq("response_id", responseId)
    .maybeSingle();

  const detail = await getResponseDetail(supabase, responseId);
  if (!detail || detail.formId !== formId) notFound();

  const completed = detail.status === "completed";
  const activity = responseActivity(detail);
  const [insights, { data: followUpRows }] = await Promise.all([
    insightsFor(supabase, [responseId]),
    supabase
      .from("response_followups")
      .select("question_id, prompt, answer")
      .eq("response_id", responseId),
  ]);
  const insight = insights.get(responseId) ?? null;
  const followUps = new Map((followUpRows ?? []).map((f) => [f.question_id, f]));
  const adjacent = await getAdjacentResponseIds(supabase, formId, detail);
  const [{ data: record }, comments, members, timeline, canReplay, order] =
    await Promise.all([
      supabase
        .from("responses")
        .select("review_status, assignee_id")
        .eq("id", responseId)
        .single(),
      listComments(supabase, responseId),
      assignableMembers(supabase, workspace.id),
      getResponseTimeline(supabase, {
        id: responseId,
        startedAt: detail.startedAt,
        lastActiveAt: detail.lastActiveAt,
        completedAt: detail.completedAt,
        status: detail.status,
      }),
      viewOnly
        ? Promise.resolve(false)
        : hasPermission(supabase, workspace.id, "manage_integrations"),
      getOrder(supabase, responseId),
    ]);

  // Show the respondent's original file name, not the internal upload
  // reference the answer value stores.
  const uploads = new Map<
    string,
    { url: string | null; name: string; size: number | null }
  >();
  // Signatures (F-10): the drawn image and when it was signed.
  const signatures = new Map<string, { url: string | null; signedAt: string }>();
  const fileQuestionIds = detail.answers
    .filter(
      (a) =>
        (a.question.type === "file_upload" || a.question.type === "signature") &&
        a.formatted,
    )
    .map((a) => a.questionId);
  if (fileQuestionIds.length > 0) {
    const { data: rows } = await supabase
      .from("uploads")
      .select("id, question_id, storage_path, original_filename, size_bytes, created_at")
      .eq("response_id", responseId)
      .in("question_id", fileQuestionIds);
    for (const row of rows ?? []) {
      const answer = detail.answers.find((a) => a.questionId === row.question_id);
      if (answer?.question.type === "signature") {
        if (answer.value !== row.id) continue;
        signatures.set(row.question_id, {
          // An <img> shows it; the download disposition only matters if
          // someone opens the link itself.
          url: await getUploadSignedUrl(
            supabase,
            row.storage_path,
            3600,
            "signature.png",
          ),
          signedAt: row.created_at,
        });
        continue;
      }
      uploads.set(row.question_id, {
        url: await getUploadSignedUrl(
          supabase,
          row.storage_path,
          3600,
          row.original_filename || true,
        ),
        name: row.original_filename,
        size: row.size_bytes,
      });
    }
  }

  // PDF documents (F-07): the summary always; set-up ones this response
  // qualifies for, with their number once issued.
  const documents: { kind: DocumentKind; label: string; number: string | null }[] = [];
  if (completed) {
    const [configured, { data: issued }] = await Promise.all([
      listFormDocuments(supabase, formId),
      supabase
        .from("response_documents")
        .select("number, form_documents!inner(kind)")
        .eq("response_id", responseId),
    ]);
    const enabled = configured.filter((d) => d.enabled);
    const ctx = enabled.some((d) => d.kind !== "summary" && d.kind !== "registration")
      ? await loadResponseContext(createAdminClient(), responseId)
      : null;
    const numberOf = (kind: DocumentKind) => {
      const row = (issued ?? []).find(
        (r) => (r.form_documents as { kind: string }).kind === kind,
      );
      const doc = configured.find((d) => d.kind === kind);
      return row && doc ? documentNumber(doc.settings, row.number) : null;
    };
    if (!enabled.some((d) => d.kind === "summary")) {
      documents.push({
        kind: "summary",
        label: DOCUMENT_KIND_LABEL.summary,
        number: null,
      });
    }
    for (const doc of enabled) {
      const applies =
        doc.kind === "summary" || doc.kind === "registration"
          ? true
          : ctx
            ? documentApplies(doc.kind, doc.settings, ctx)
            : false;
      if (applies) {
        documents.push({
          kind: doc.kind,
          label: DOCUMENT_KIND_LABEL[doc.kind],
          number: numberOf(doc.kind),
        });
      }
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
        {!viewOnly && (
          <DeleteResponseButton
            formId={formId}
            responseId={responseId}
            redirectTo={listHref}
            who={who}
            variant="outline"
          />
        )}
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
          <span>Version {detail.versionNumber}</span>
          <span>Source: {source}</span>
        </div>
      </div>

      {documents.length > 0 && (
        <nav
          aria-label="Documents"
          className="text-muted-foreground -mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm"
        >
          <span className="font-semibold">PDF:</span>
          {documents.map((d) => (
            <a
              key={d.kind}
              href={`/api/forms/${formId}/responses/${responseId}/documents/${d.kind}`}
              download
              className="text-foreground inline-flex items-center gap-1.5 font-semibold underline-offset-2 hover:underline"
            >
              <Download className="size-3.5" />
              {d.label}
              {d.number && (
                <span className="text-muted-foreground font-normal">{d.number}</span>
              )}
            </a>
          ))}
        </nav>
      )}

      <RecordControls
        formId={formId}
        responseId={responseId}
        status={record?.review_status ?? "new"}
        assigneeId={record?.assignee_id ?? null}
        members={members}
        canChange={!viewOnly}
      />

      {payment && (
        <section className="border-ink bg-card flex flex-wrap items-center gap-3 rounded-lg border-[1.5px] px-[18px] py-3 text-sm">
          <b>Payment</b>
          <span className="font-heading text-lg font-bold">
            {formatAmount(payment.amount, payment.currency)}
          </span>
          <span
            className={
              payment.status === "paid"
                ? "rounded-full bg-[var(--chip-live-bg)] px-2.5 py-0.5 text-[12px] font-bold text-[var(--chip-live-fg)]"
                : "rounded-full bg-[var(--chip-draft-bg)] px-2.5 py-0.5 text-[12px] font-bold text-[var(--chip-draft-fg)]"
            }
          >
            {payment.status === "paid"
              ? payment.refunded_amount
                ? "Paid, partly refunded"
                : "Paid"
              : payment.status === "refunded"
                ? "Refunded"
                : payment.status === "pending"
                  ? "Not paid yet"
                  : payment.status === "expired"
                    ? "Expired"
                    : "Failed"}
          </span>
          <span className="text-muted-foreground text-xs">
            {[
              PROVIDER_LABEL[payment.provider as keyof typeof PROVIDER_LABEL] ??
                payment.provider,
              payment.coupon_code
                ? `coupon ${payment.coupon_code} (−${formatAmount(payment.discount, payment.currency)})`
                : null,
              payment.refunded_amount
                ? `${formatAmount(payment.refunded_amount, payment.currency)} refunded`
                : null,
              payment.provider_payment_id,
              payment.provider !== "coupon" && !payment.livemode ? "test mode" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </section>
      )}

      {order && (
        <section className="border-ink bg-card rounded-lg border-[1.5px] px-[18px] py-4">
          <h2 className="text-muted-foreground mb-2.5 text-[11.5px] font-bold tracking-[0.1em] uppercase">
            Order
          </h2>
          <table className="w-full text-sm">
            <tbody>
              {order.lines.map((line) => (
                <tr key={line.itemId} className="border-border border-b">
                  <td className="py-1.5 pr-3">
                    {line.quantity} × {line.label}
                  </td>
                  <td className="text-muted-foreground py-1.5 pr-3 text-right">
                    {formatMoney(line.unitAmount, order.currency)} each
                  </td>
                  <td className="py-1.5 text-right font-semibold">
                    {formatMoney(line.amount, order.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} className="pt-2 font-bold">
                  Total
                </td>
                <td className="font-heading pt-2 text-right text-lg font-bold">
                  {formatMoney(order.total, order.currency)}
                </td>
              </tr>
            </tfoot>
          </table>
        </section>
      )}

      {completed && (
        <ResponseInsightCard
          formId={formId}
          responseId={responseId}
          enabled={aiConfigured()}
          canRun={!viewOnly}
          insight={insight}
        />
      )}

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
          const signature = signatures.get(answer.questionId);
          const wide =
            answer.question.type === "long_text" ||
            answer.question.type === "contact_info" ||
            answer.question.type === "file_upload" ||
            answer.question.type === "signature" ||
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
              {signature ? (
                <figure className="flex flex-col gap-1.5">
                  {signature.url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed storage URL
                    <img
                      src={signature.url}
                      alt={`Signature for “${answer.label}”`}
                      className="border-border h-auto max-h-[140px] w-auto max-w-full self-start rounded-[8px] border bg-white"
                    />
                  ) : (
                    <p className="text-subtle-foreground text-sm italic">
                      Signature image unavailable
                    </p>
                  )}
                  <figcaption className="text-muted-foreground text-xs">
                    Signed <LocalTime iso={signature.signedAt} /> · electronic signature,
                    not certified
                  </figcaption>
                </figure>
              ) : upload ? (
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
              {followUps.get(answer.questionId) && (
                <div className="border-border mt-1 border-t pt-2.5">
                  <p className="text-muted-foreground text-[13px]">
                    Follow-up (written by AI): {followUps.get(answer.questionId)!.prompt}
                  </p>
                  <p className="mt-1 text-[15px] leading-[1.45] font-semibold break-words whitespace-pre-wrap">
                    {followUps.get(answer.questionId)!.answer || (
                      <span className="text-subtle-foreground italic">Skipped</span>
                    )}
                  </p>
                </div>
              )}
            </section>
          );
        })}
      </div>

      <div className="grid items-start gap-3.5 md:grid-cols-2">
        <ResponseComments
          formId={formId}
          responseId={responseId}
          comments={comments}
          canComment={!viewOnly}
        />
        <ResponseTimeline
          formId={formId}
          responseId={responseId}
          entries={timeline}
          canReplay={canReplay}
        />
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
