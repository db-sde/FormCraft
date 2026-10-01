import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
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
/** Rows per request when exporting — below PostgREST's 1000-row cap. */
const EXPORT_PAGE = 500;
export const MAX_LEAD_EXPORT_ROWS = 10_000;

function text(record: Record<string, unknown>, field: ContactField): string {
  const v = record[field];
  return typeof v === "string" ? v.trim() : "";
}

type LeadRow = Database["public"]["Functions"]["list_leads"]["Returns"][number];

function toLead(row: LeadRow): Lead {
  const record =
    row.value && typeof row.value === "object" && !Array.isArray(row.value)
      ? (row.value as Record<string, unknown>)
      : {};
  return {
    responseId: row.response_id,
    formId: row.form_id,
    formTitle: row.form_title,
    name: text(record, "name"),
    email: text(record, "email"),
    phone: text(record, "phone"),
    company: text(record, "company"),
    completed: row.status === "completed",
    lastActiveAt: row.last_active_at,
    source: describeSource({ utmSource: row.utm_source, referrer: row.referrer }),
    capturedAt: row.captured_at,
  };
}

async function fetchLeads(
  supabase: Client,
  workspaceId: string,
  options: { formId?: string; search?: string; limit: number; offset: number },
) {
  const { data, error } = await supabase.rpc("list_leads", {
    p_workspace_id: workspaceId,
    p_form_id: options.formId,
    p_search: options.search?.trim().slice(0, 80) || undefined,
    p_limit: options.limit,
    p_offset: options.offset,
  });
  if (error) throw error;
  return data ?? [];
}

/**
 * Everyone who left contact details in a lead-capture block, across the
 * workspace's forms (or one form), newest first — including respondents
 * who never submitted: capturing those is the whole point of asking for
 * contact details before the last question. The database function
 * (list_leads) does the finding, de-duplication, searching and exact
 * counting; the caller's own session is used, so row-level security
 * limits it to their workspaces.
 */
export async function listLeads(
  supabase: Client,
  workspaceId: string,
  options: { page?: number; formId?: string; search?: string } = {},
): Promise<LeadPage> {
  const page = Math.max(1, options.page ?? 1);
  const rows = await fetchLeads(supabase, workspaceId, {
    formId: options.formId,
    search: options.search,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  // The total rides along on every row; an empty page past the end
  // needs its own count so "page 9 of 8" can't happen.
  const totalCount =
    rows.length > 0
      ? Number(rows[0].total_count)
      : page > 1
        ? ((
            await fetchLeads(supabase, workspaceId, {
              formId: options.formId,
              search: options.search,
              limit: 1,
              offset: 0,
            })
          )[0]?.total_count ?? 0)
        : 0;

  return {
    items: rows.map(toLead),
    totalCount: Number(totalCount),
    page,
    pageCount: Math.max(1, Math.ceil(Number(totalCount) / PAGE_SIZE)),
  };
}

/** Number of leads captured in the workspace (for dashboard stats). */
export async function countLeads(supabase: Client, workspaceId: string): Promise<number> {
  const rows = await fetchLeads(supabase, workspaceId, { limit: 1, offset: 0 });
  return Number(rows[0]?.total_count ?? 0);
}

/** CSV of every lead (optionally one form's), newest first. */
export async function buildLeadsCsv(
  supabase: Client,
  workspaceId: string,
  formId?: string,
): Promise<string> {
  const leads: Lead[] = [];
  for (let offset = 0; offset < MAX_LEAD_EXPORT_ROWS; offset += EXPORT_PAGE) {
    const rows = await fetchLeads(supabase, workspaceId, {
      formId,
      limit: EXPORT_PAGE,
      offset,
    });
    leads.push(...rows.map(toLead));
    if (rows.length < EXPORT_PAGE) break;
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
