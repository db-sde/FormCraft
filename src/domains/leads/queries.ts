import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { parseFormSchema } from "@/domains/forms/schema";
import type { ContactField } from "@/domains/forms/schema/question-types";
import { toCsv } from "@/domains/exports";
import {
  ACTIVITY_LABEL,
  describeSource,
  responseActivity,
} from "@/domains/responses/activity";

type Client = SupabaseClient<Database>;

export type Lead = {
  responseId: string;
  formId: string;
  formTitle: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  /** Whether the respondent went on to submit the form. */
  completed: boolean;
  /** The response's last activity (drives In progress vs Abandoned). */
  lastActiveAt: string;
  /** Campaign source / referring site / "Direct". */
  source: string;
  /** When the contact details were last saved. */
  capturedAt: string;
};

export type LeadPage = {
  items: Lead[];
  totalCount: number;
  page: number;
  pageCount: number;
};

const PAGE_SIZE = 25;
const FETCH_PAGE = 1000;

type ContactSource = { formId: string; formTitle: string; questionIds: Set<string> };

/**
 * Which questions are lead-capture (Contact info) blocks, per form — in
 * *any* version, since a lead captured on an older published version
 * is still a lead.
 */
async function contactSources(
  supabase: Client,
  workspaceId: string,
  formId?: string,
): Promise<ContactSource[]> {
  let formsQuery = supabase
    .from("forms")
    .select("id, title")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);
  if (formId) formsQuery = formsQuery.eq("id", formId);
  const { data: forms, error } = await formsQuery.limit(FETCH_PAGE);
  if (error) throw error;
  if (!forms?.length) return [];

  const sources = new Map<string, ContactSource>(
    forms.map((f) => [
      f.id,
      { formId: f.id, formTitle: f.title, questionIds: new Set() },
    ]),
  );
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data: versions, error: versionsError } = await supabase
      .from("form_versions")
      .select("form_id, schema")
      .in("form_id", [...sources.keys()])
      .order("id")
      .range(from, from + FETCH_PAGE - 1);
    if (versionsError) throw versionsError;
    for (const version of versions) {
      const schema = parseFormSchema(version.schema);
      for (const q of schema.questions) {
        if (q.type === "contact_info")
          sources.get(version.form_id)?.questionIds.add(q.id);
      }
    }
    if (versions.length < FETCH_PAGE) break;
  }
  return [...sources.values()].filter((s) => s.questionIds.size > 0);
}

function text(record: Record<string, unknown>, field: ContactField): string {
  const v = record[field];
  return typeof v === "string" ? v.trim() : "";
}

type LeadRow = {
  value: unknown;
  question_id: string;
  updated_at: string;
  responses: {
    id: string;
    form_id: string;
    status: string;
    last_active_at: string;
    referrer: string | null;
    utm_source: string | null;
  } | null;
};

function toLead(row: LeadRow, sources: Map<string, ContactSource>): Lead | null {
  const response = row.responses;
  if (!response) return null;
  const source = sources.get(response.form_id);
  // Question ids are only unique within a form — make sure this answer
  // really belongs to that form's contact block.
  if (!source?.questionIds.has(row.question_id)) return null;
  const record =
    row.value && typeof row.value === "object" && !Array.isArray(row.value)
      ? (row.value as Record<string, unknown>)
      : {};
  const lead: Lead = {
    responseId: response.id,
    formId: source.formId,
    formTitle: source.formTitle,
    name: text(record, "name"),
    email: text(record, "email"),
    phone: text(record, "phone"),
    company: text(record, "company"),
    completed: response.status === "completed",
    lastActiveAt: response.last_active_at,
    source: describeSource({
      utmSource: response.utm_source,
      referrer: response.referrer,
    }),
    capturedAt: row.updated_at,
  };
  return lead.name || lead.email || lead.phone || lead.company ? lead : null;
}

/** Keeps only characters that are safe inside a PostgREST `or` filter
 * and meaningful in a contact search. */
function searchTerm(raw: string | undefined): string | null {
  const term = (raw ?? "")
    .replace(/[^\p{L}\p{N}@.+\-_ ]/gu, "")
    .trim()
    .slice(0, 80);
  return term.length >= 2 ? term : null;
}

function leadsQuery(supabase: Client, sources: ContactSource[], search?: string) {
  const questionIds = [...new Set(sources.flatMap((s) => [...s.questionIds]))];
  const term = searchTerm(search);
  const query = supabase
    .from("answers")
    .select(
      "value, question_id, updated_at, responses!inner(id, form_id, status, last_active_at, referrer, utm_source)",
      {
        count: "exact",
      },
    )
    .in("question_id", questionIds)
    .in(
      "responses.form_id",
      sources.map((s) => s.formId),
    )
    .order("updated_at", { ascending: false });
  return term
    ? query.or(
        ["name", "email", "phone", "company"]
          .map((field) => `value->>${field}.ilike.*${term}*`)
          .join(","),
      )
    : query;
}

/**
 * Everyone who left contact details in a lead-capture block, across the
 * workspace's forms (or one form) — including respondents who never
 * submitted: capturing those is the whole point of asking for contact
 * details before the last question. Session-scoped client, so RLS
 * limits it to the caller's own workspaces.
 */
export async function listLeads(
  supabase: Client,
  workspaceId: string,
  options: { page?: number; formId?: string; search?: string } = {},
): Promise<LeadPage> {
  const page = Math.max(1, options.page ?? 1);
  const sources = await contactSources(supabase, workspaceId, options.formId);
  if (sources.length === 0) return { items: [], totalCount: 0, page, pageCount: 1 };

  const from = (page - 1) * PAGE_SIZE;
  const { data, error, count } = await leadsQuery(
    supabase,
    sources,
    options.search,
  ).range(from, from + PAGE_SIZE - 1);
  if (error) throw error;

  const bySource = new Map(sources.map((s) => [s.formId, s]));
  const items = (data as unknown as LeadRow[])
    .map((row) => toLead(row, bySource))
    .filter((lead): lead is Lead => lead !== null);

  return {
    items,
    totalCount: count ?? 0,
    page,
    pageCount: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)),
  };
}

/** Number of leads captured in the workspace (for dashboard stats). */
export async function countLeads(supabase: Client, workspaceId: string): Promise<number> {
  const sources = await contactSources(supabase, workspaceId);
  if (sources.length === 0) return 0;
  const { count, error } = await leadsQuery(supabase, sources).range(0, 0);
  if (error) throw error;
  return count ?? 0;
}

export const MAX_LEAD_EXPORT_ROWS = 10_000;

/** CSV of every lead (optionally one form's), newest first. */
export async function buildLeadsCsv(
  supabase: Client,
  workspaceId: string,
  formId?: string,
): Promise<string> {
  const sources = await contactSources(supabase, workspaceId, formId);
  const bySource = new Map(sources.map((s) => [s.formId, s]));
  const leads: Lead[] = [];
  if (sources.length > 0) {
    for (let from = 0; from < MAX_LEAD_EXPORT_ROWS; from += FETCH_PAGE) {
      const { data, error } = await leadsQuery(supabase, sources).range(
        from,
        from + FETCH_PAGE - 1,
      );
      if (error) throw error;
      for (const row of data as unknown as LeadRow[]) {
        const lead = toLead(row, bySource);
        if (lead) leads.push(lead);
      }
      if (data.length < FETCH_PAGE) break;
    }
  }

  const columns = [
    "Name",
    "Email",
    "Phone",
    "Company",
    "Form",
    "Status",
    "Source",
    "Captured at",
  ];
  return toCsv(
    columns,
    leads.map((lead) => ({
      Name: lead.name,
      Email: lead.email,
      Phone: lead.phone,
      Company: lead.company,
      Form: lead.formTitle,
      Status:
        ACTIVITY_LABEL[
          responseActivity({
            status: lead.completed ? "completed" : "partial",
            lastActiveAt: lead.lastActiveAt,
          })
        ],
      Source: lead.source,
      "Captured at": lead.capturedAt,
    })),
  );
}
