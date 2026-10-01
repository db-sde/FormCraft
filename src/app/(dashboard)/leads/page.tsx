import Link from "next/link";
import { Contact, Download, Mail, Phone, UsersRound } from "lucide-react";
import { listLeads } from "@/domains/leads";
import { listFormsForWorkspace } from "@/domains/forms";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { PageHeader } from "@/components/app-shell/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Pagination } from "@/components/shared/pagination";
import { FormFilter } from "@/components/dashboard/form-filter";
import { LocalTime } from "@/components/local-time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Metadata } from "next";
import { responseActivity } from "@/domains/responses/activity";
import { ActivityChip } from "@/components/responses/activity-chip";

export const metadata: Metadata = { title: "Leads" };

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; form?: string; q?: string }>;
}) {
  const { page: pageParam, form: formParam, q } = await searchParams;
  const { supabase, workspace } = await getCurrentWorkspace();
  const forms = await listFormsForWorkspace(supabase, workspace.id);
  const formId = forms.some((f) => f.id === formParam) ? formParam : undefined;
  const page = Math.max(1, Number(pageParam) || 1);
  const leads = await listLeads(supabase, workspace.id, { page, formId, search: q });

  const exportHref = `/api/leads/export.csv${formId ? `?form=${formId}` : ""}`;
  const hrefFor = (p: number) =>
    `/leads?${formId ? `form=${formId}&` : ""}${q ? `q=${encodeURIComponent(q)}&` : ""}page=${p}`;

  return (
    <>
      <PageHeader
        eyebrow={`${leads.totalCount.toLocaleString()} lead${leads.totalCount === 1 ? "" : "s"} in ${workspace.name}`}
        title="Leads"
        description="Everyone who left their contact details in one of your forms — including people who didn't finish."
        actions={
          leads.totalCount > 0 && (
            <Button asChild variant="outline" className="h-11 font-semibold">
              <a href={exportHref} download>
                <Download />
                Export CSV
              </a>
            </Button>
          )
        }
      />

      {forms.length > 0 && (
        <div className="mb-[22px] flex flex-col gap-3 sm:flex-row">
          <form action="/leads" className="flex-1 sm:max-w-xs">
            {formId && <input type="hidden" name="form" value={formId} />}
            <Input
              type="search"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Search name, email, phone…"
              aria-label="Search leads"
            />
          </form>
          <FormFilter
            forms={forms.map((f) => ({ id: f.id, title: f.title }))}
            value={formId}
          />
        </div>
      )}

      {leads.items.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title={
            q
              ? `No leads match “${q}”`
              : formId
                ? "No leads from this form yet"
                : "No leads yet"
          }
          description={
            <>
              Leads come from a <strong>Contact info</strong> step in your form. Put it
              before your last question: the moment someone gets past it, their name,
              email and phone are saved here — even if they never hit submit.
            </>
          }
          actions={
            forms.length > 0 ? (
              <Button asChild>
                <Link href={`/forms/${formId ?? forms[0].id}?leadCapture=1`}>
                  <Contact />
                  Add lead capture to a form
                </Link>
              </Button>
            ) : (
              <Button asChild>
                <Link href="/dashboard">Create a form</Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="border-ink bg-card overflow-hidden rounded-lg border-[1.5px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead className="hidden md:table-cell">Company</TableHead>
                  <TableHead className="hidden lg:table-cell">Form</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden xl:table-cell">Source</TableHead>
                  <TableHead className="whitespace-nowrap">Captured</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.items.map((lead) => (
                  <TableRow key={lead.responseId} className="relative">
                    <TableCell className="font-semibold">
                      <Link
                        href={`/forms/${lead.formId}/responses/${lead.responseId}`}
                        className="after:absolute after:inset-0 after:content-['']"
                      >
                        {lead.name || (
                          <span className="text-muted-foreground">No name</span>
                        )}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="relative z-10 flex flex-col gap-0.5 text-sm">
                        {lead.email && (
                          <a
                            href={`mailto:${lead.email}`}
                            className="flex items-center gap-1.5 hover:underline"
                          >
                            <Mail className="text-muted-foreground size-3.5" />
                            {lead.email}
                          </a>
                        )}
                        {lead.phone && (
                          <a
                            href={`tel:${lead.phone}`}
                            className="text-muted-foreground flex items-center gap-1.5 hover:underline"
                          >
                            <Phone className="size-3.5" />
                            {lead.phone}
                          </a>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden md:table-cell">
                      {lead.company || "—"}
                    </TableCell>
                    <TableCell className="hidden max-w-48 lg:table-cell">
                      <span className="line-clamp-1">{lead.formTitle}</span>
                    </TableCell>
                    <TableCell>
                      <ActivityChip
                        activity={responseActivity({
                          status: lead.completed ? "completed" : "partial",
                          lastActiveAt: lead.lastActiveAt,
                        })}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden max-w-32 xl:table-cell">
                      <span className="line-clamp-1">{lead.source}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      <LocalTime iso={lead.capturedAt} variant="relative" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination page={leads.page} pageCount={leads.pageCount} hrefFor={hrefFor} />
        </>
      )}
    </>
  );
}
