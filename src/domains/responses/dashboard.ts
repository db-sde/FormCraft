import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { parseFormSchema } from "@/domains/forms/schema";
import type { FormSchemaV1, QuestionV1 } from "@/domains/forms/schema/v1";
import { formatAnswerValue, questionColumnLabel } from "./format";
import {
  toCsv,
  ExportTooLargeError,
  MAX_SYNCHRONOUS_EXPORT_ROWS,
} from "@/domains/exports";

type Client = SupabaseClient<Database>;

const PAGE_SIZE = 25;

export type ResponseListItem = {
  id: string;
  status: "in_progress" | "partial" | "completed";
  startedAt: string;
  completedAt: string | null;
  endingTitle: string | null;
  /** Formatted answers for `previewColumns`, keyed by question id. */
  preview: Record<string, string>;
};

export type ResponseListPage = {
  items: ResponseListItem[];
  totalCount: number;
  page: number;
  pageCount: number;
  previewColumns: { questionId: string; label: string }[];
};

const PREVIEW_COLUMN_COUNT = 3;

function isAnswerable(q: QuestionV1): boolean {
  return q.type !== "welcome_screen" && q.type !== "statement";
}

async function getLatestSchema(
  supabase: Client,
  formId: string,
): Promise<FormSchemaV1 | null> {
  const { data, error } = await supabase
    .from("form_versions")
    .select("schema")
    .eq("form_id", formId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? parseFormSchema(data.schema) : null;
}

/**
 * Creator-facing response list — always scoped by the caller's own
 * session (RLS via `responses: members can read via form`), never the
 * admin client. Defaults to completed responses only, matching the
 * dashboard's job of showing submissions rather than every abandoned
 * session; `includeIncomplete` opts into seeing partial/in_progress
 * ones too. Bounded pagination — never an unbounded fetch (spec).
 */
export async function listResponses(
  supabase: Client,
  formId: string,
  options: { page?: number; includeIncomplete?: boolean } = {},
): Promise<ResponseListPage> {
  const page = Math.max(1, options.page ?? 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from("responses")
    .select("id, status, started_at, completed_at, ending_id, form_version_id", {
      count: "exact",
    })
    .eq("form_id", formId);

  // Completed submissions read newest-submitted first; a response
  // started last week but submitted a minute ago belongs at the top.
  query = options.includeIncomplete
    ? query.order("started_at", { ascending: false })
    : query.eq("status", "completed").order("completed_at", { ascending: false });

  const { data, error, count } = await query.range(from, to);
  if (error) throw error;
  const rows = data ?? [];

  // Same column rule as CSV export: the latest version's questions.
  const latest = await getLatestSchema(supabase, formId);
  const previewQuestions = (latest?.questions ?? [])
    .filter(isAnswerable)
    .slice(0, PREVIEW_COLUMN_COUNT);

  const answersByResponse = new Map<string, Map<string, unknown>>();
  if (rows.length > 0 && previewQuestions.length > 0) {
    const { data: answerRows, error: answersError } = await supabase
      .from("answers")
      .select("response_id, question_id, value")
      .in(
        "response_id",
        rows.map((r) => r.id),
      )
      .in(
        "question_id",
        previewQuestions.map((q) => q.id),
      );
    if (answersError) throw answersError;
    for (const a of answerRows ?? []) {
      const forResponse = answersByResponse.get(a.response_id) ?? new Map();
      forResponse.set(a.question_id, a.value);
      answersByResponse.set(a.response_id, forResponse);
    }
  }

  // Ending titles and answer formatting come from each response's own
  // form_version (not necessarily the current one) — cached per
  // form_version_id so a page of same-version responses only parses
  // that schema once.
  const items: ResponseListItem[] = [];
  const schemaCache = new Map<string, FormSchemaV1>();

  for (const row of rows) {
    const schema = await getSchemaForVersion(supabase, row.form_version_id, schemaCache);
    const endingTitle = row.ending_id
      ? (schema?.endings.find((e) => e.id === row.ending_id)?.title ?? null)
      : null;

    const answers = answersByResponse.get(row.id);
    const preview: Record<string, string> = {};
    for (const ref of previewQuestions) {
      const own = schema?.questions.find((q) => q.id === ref.id) ?? ref;
      preview[ref.id] = formatAnswerValue(own, answers?.get(ref.id));
    }

    items.push({
      id: row.id,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      endingTitle,
      preview,
    });
  }

  return {
    items,
    totalCount: count ?? 0,
    page,
    pageCount: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)),
    previewColumns: previewQuestions.map((q) => ({
      questionId: q.id,
      label: questionColumnLabel(q),
    })),
  };
}

/** The completed responses immediately newer/older than the given one,
 * in the same order the response list uses — for prev/next on the
 * detail page. */
export async function getAdjacentResponseIds(
  supabase: Client,
  formId: string,
  completedAt: string,
): Promise<{ newerId: string | null; olderId: string | null }> {
  const base = () =>
    supabase
      .from("responses")
      .select("id")
      .eq("form_id", formId)
      .eq("status", "completed");

  const [newer, older] = await Promise.all([
    base()
      .gt("completed_at", completedAt)
      .order("completed_at", { ascending: true })
      .limit(1),
    base()
      .lt("completed_at", completedAt)
      .order("completed_at", { ascending: false })
      .limit(1),
  ]);
  if (newer.error) throw newer.error;
  if (older.error) throw older.error;

  return {
    newerId: newer.data?.[0]?.id ?? null,
    olderId: older.data?.[0]?.id ?? null,
  };
}

async function getSchemaForVersion(
  supabase: Client,
  formVersionId: string,
  cache: Map<string, FormSchemaV1>,
): Promise<FormSchemaV1 | null> {
  const cached = cache.get(formVersionId);
  if (cached) return cached;

  const { data, error } = await supabase
    .from("form_versions")
    .select("schema")
    .eq("id", formVersionId)
    .single();
  if (error || !data) return null;

  const parsed = parseFormSchema(data.schema);
  cache.set(formVersionId, parsed);
  return parsed;
}

export type ResponseDetail = {
  id: string;
  formId: string;
  status: "in_progress" | "partial" | "completed";
  startedAt: string;
  completedAt: string | null;
  lastActiveAt: string;
  endingTitle: string | null;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  answers: {
    questionId: string;
    label: string;
    formatted: string;
    question: QuestionV1;
  }[];
};

export async function getResponseDetail(
  supabase: Client,
  responseId: string,
): Promise<ResponseDetail | null> {
  const { data: response, error } = await supabase
    .from("responses")
    .select(
      "id, form_id, status, started_at, completed_at, last_active_at, ending_id, form_version_id, referrer, utm_source, utm_medium, utm_campaign",
    )
    .eq("id", responseId)
    .maybeSingle();
  if (error) throw error;
  if (!response) return null;

  const { data: versionRow, error: versionError } = await supabase
    .from("form_versions")
    .select("schema")
    .eq("id", response.form_version_id)
    .single();
  if (versionError) throw versionError;
  const schema = parseFormSchema(versionRow.schema);

  const { data: answerRows, error: answersError } = await supabase
    .from("answers")
    .select("question_id, value")
    .eq("response_id", responseId);
  if (answersError) throw answersError;

  const answersByQuestion = new Map(
    (answerRows ?? []).map((a) => [a.question_id, a.value]),
  );

  const answers = schema.questions
    .filter((q) => q.type !== "welcome_screen" && q.type !== "statement")
    .map((q) => ({
      questionId: q.id,
      label: questionColumnLabel(q),
      formatted: formatAnswerValue(q, answersByQuestion.get(q.id)),
      question: q,
    }));

  return {
    id: response.id,
    formId: response.form_id,
    status: response.status,
    startedAt: response.started_at,
    completedAt: response.completed_at,
    lastActiveAt: response.last_active_at,
    endingTitle: schema.endings.find((e) => e.id === response.ending_id)?.title ?? null,
    referrer: response.referrer,
    utmSource: response.utm_source,
    utmMedium: response.utm_medium,
    utmCampaign: response.utm_campaign,
    answers,
  };
}

export async function deleteResponse(
  supabase: Client,
  responseId: string,
): Promise<void> {
  const { error } = await supabase.from("responses").delete().eq("id", responseId);
  if (error) throw error;
}

export type ResponseCounts = { completed: number; partial: number; inProgress: number };

export async function getResponseCounts(
  supabase: Client,
  formId: string,
): Promise<ResponseCounts> {
  const [completed, partial, inProgress] = await Promise.all([
    supabase
      .from("responses")
      .select("id", { count: "exact", head: true })
      .eq("form_id", formId)
      .eq("status", "completed"),
    supabase
      .from("responses")
      .select("id", { count: "exact", head: true })
      .eq("form_id", formId)
      .eq("status", "partial"),
    supabase
      .from("responses")
      .select("id", { count: "exact", head: true })
      .eq("form_id", formId)
      .eq("status", "in_progress"),
  ]);

  if (completed.error) throw completed.error;
  if (partial.error) throw partial.error;
  if (inProgress.error) throw inProgress.error;

  return {
    completed: completed.count ?? 0,
    partial: partial.count ?? 0,
    inProgress: inProgress.count ?? 0,
  };
}

/**
 * Builds the CSV export for a form's completed responses. Column set
 * comes from the most recently created form_version's questions (the
 * closest thing to "current"), but each response's own cells are
 * resolved against *that response's own* form_version schema (matched
 * by stable question id) — so a response from an older version still
 * shows correct option labels even if a question's options changed
 * later, and a question added after that response was submitted is
 * simply blank for it rather than misattributed.
 */
export async function buildResponsesCsv(
  supabase: Client,
  formId: string,
): Promise<string> {
  const { data: latestVersion, error: latestVersionError } = await supabase
    .from("form_versions")
    .select("schema")
    .eq("form_id", formId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestVersionError) throw latestVersionError;

  const referenceQuestions = latestVersion
    ? parseFormSchema(latestVersion.schema).questions.filter(
        (q) => q.type !== "welcome_screen" && q.type !== "statement",
      )
    : [];

  const { data: responses, error: responsesError } = await supabase
    .from("responses")
    .select("id, completed_at, ending_id, form_version_id")
    .eq("form_id", formId)
    .eq("status", "completed")
    .order("completed_at", { ascending: true })
    .limit(MAX_SYNCHRONOUS_EXPORT_ROWS + 1);
  if (responsesError) throw responsesError;

  if ((responses ?? []).length > MAX_SYNCHRONOUS_EXPORT_ROWS) {
    throw new ExportTooLargeError(responses!.length);
  }

  const schemaCache = new Map<string, FormSchemaV1>();
  const rows: Record<string, unknown>[] = [];

  for (const response of responses ?? []) {
    const schema = await getSchemaForVersion(
      supabase,
      response.form_version_id,
      schemaCache,
    );
    const { data: answerRows } = await supabase
      .from("answers")
      .select("question_id, value")
      .eq("response_id", response.id);
    const answersByQuestion = new Map(
      (answerRows ?? []).map((a) => [a.question_id, a.value]),
    );

    const row: Record<string, unknown> = {
      "Submitted at": response.completed_at,
      Ending: schema?.endings.find((e) => e.id === response.ending_id)?.title ?? "",
    };

    for (const refQuestion of referenceQuestions) {
      const ownQuestion =
        schema?.questions.find((q) => q.id === refQuestion.id) ?? refQuestion;
      row[questionColumnLabel(refQuestion)] = formatAnswerValue(
        ownQuestion,
        answersByQuestion.get(refQuestion.id),
      );
    }

    rows.push(row);
  }

  const columns = [
    "Submitted at",
    "Ending",
    ...referenceQuestions.map(questionColumnLabel),
  ];
  return toCsv(columns, rows);
}
