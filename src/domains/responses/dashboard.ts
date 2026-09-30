import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { parseFormSchema } from "@/domains/forms/schema";
import type { FormSchemaV1, QuestionV1 } from "@/domains/forms/schema/v1";
import {
  answerCells,
  formatAnswerValue,
  questionColumnLabel,
  questionColumnLabels,
} from "./format";
import { hasAnswer } from "@/domains/logic/validate-answer";
import { ABANDONED_AFTER_MINUTES, describeSource } from "./activity";
import {
  toCsv,
  ExportTooLargeError,
  MAX_SYNCHRONOUS_EXPORT_ROWS,
} from "@/domains/exports";

type Client = SupabaseClient<Database>;

const PAGE_SIZE = 25;
/** Rows per request — must not exceed PostgREST's max_rows (1000). */
const FETCH_PAGE = 1000;
/** Response ids per `.in()` filter, keeping request URLs short. */
const ID_BATCH = 100;

export type ResponseView = "completed" | "incomplete";

export type ResponseListItem = {
  id: string;
  status: "in_progress" | "partial" | "completed";
  startedAt: string;
  completedAt: string | null;
  lastActiveAt: string;
  endingTitle: string | null;
  /** Formatted answers for `previewColumns`, keyed by question id. */
  preview: Record<string, string>;
  /** How far the respondent got: answered questions / answerable ones. */
  progress: { answered: number; total: number };
  /** Where an unfinished respondent stopped. */
  lastQuestionLabel: string | null;
  /** Campaign source / referring site / "Direct". */
  source: string;
};

export type ResponseListPage = {
  items: ResponseListItem[];
  totalCount: number;
  page: number;
  pageCount: number;
  previewColumns: { questionId: string; label: string }[];
};

const PREVIEW_COLUMN_COUNT = 3;

const ATTRIBUTION_COLUMNS = [
  "Referrer",
  "UTM source",
  "UTM medium",
  "UTM campaign",
  "UTM term",
  "UTM content",
];

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

/** Columns shown in the list: the lead (contact) block first when the
 * form has one — it's what identifies a respondent — then the first
 * other answerable questions. */
function pickPreviewQuestions(schema: FormSchemaV1 | null): QuestionV1[] {
  const answerable = (schema?.questions ?? []).filter(isAnswerable);
  const contact = answerable.filter((q) => q.type === "contact_info");
  const rest = answerable.filter((q) => q.type !== "contact_info");
  return [...contact, ...rest].slice(0, PREVIEW_COLUMN_COUNT);
}

/**
 * Creator-facing response list — always scoped by the caller's own
 * session (RLS via `responses: members can read via form`), never the
 * admin client. Bounded pagination — never an unbounded fetch (spec).
 *
 * - "completed": submitted responses, newest submission first.
 * - "incomplete": respondents who answered at least one question but
 *   never submitted (status partial), most recently active first. A
 *   visitor who opened the form and answered nothing (in_progress) isn't
 *   listed — there's nothing to show — but is counted in Starts.
 */
export async function listResponses(
  supabase: Client,
  formId: string,
  options: { page?: number; view?: ResponseView } = {},
): Promise<ResponseListPage> {
  const page = Math.max(1, options.page ?? 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const view = options.view ?? "completed";

  let query = supabase
    .from("responses")
    .select(
      "id, status, started_at, completed_at, last_active_at, last_question_id, ending_id, form_version_id, referrer, utm_source",
      { count: "exact" },
    )
    .eq("form_id", formId);
  query =
    view === "completed"
      ? query.eq("status", "completed").order("completed_at", { ascending: false })
      : query.eq("status", "partial").order("last_active_at", { ascending: false });

  const { data, error, count } = await query.range(from, to);
  if (error) throw error;
  const rows = data ?? [];

  // Same column rule as CSV export: the latest version's questions.
  const latest = await getLatestSchema(supabase, formId);
  const previewQuestions = pickPreviewQuestions(latest);

  // Every answer for this page (not just preview columns) — progress
  // needs the full count. At most 25 responses, so well under max_rows.
  const answersByResponse = new Map<string, Map<string, unknown>>();
  if (rows.length > 0) {
    const { data: answerRows, error: answersError } = await supabase
      .from("answers")
      .select("response_id, question_id, value")
      .in(
        "response_id",
        rows.map((r) => r.id),
      )
      .limit(FETCH_PAGE);
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

    const ownAnswerable = (schema?.questions ?? []).filter(isAnswerable);
    const answered = ownAnswerable.filter((q) => hasAnswer(q, answers?.get(q.id))).length;
    const lastQuestion = schema?.questions.find((q) => q.id === row.last_question_id);

    items.push({
      id: row.id,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      lastActiveAt: row.last_active_at,
      endingTitle,
      preview,
      progress: { answered, total: ownAnswerable.length },
      lastQuestionLabel: lastQuestion ? questionColumnLabel(lastQuestion) : null,
      source: describeSource({ utmSource: row.utm_source, referrer: row.referrer }),
    });
  }

  return {
    items,
    totalCount: count ?? 0,
    page,
    pageCount: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)),
    previewColumns: previewQuestions.map((q) => ({
      questionId: q.id,
      label: q.type === "contact_info" ? "Contact" : questionColumnLabel(q),
    })),
  };
}

/** The responses immediately newer/older than the given one, in the
 * same order its list uses — for prev/next on the detail page. */
export async function getAdjacentResponseIds(
  supabase: Client,
  formId: string,
  current: { status: string; completedAt: string | null; lastActiveAt: string },
): Promise<{ newerId: string | null; olderId: string | null }> {
  const completed = current.status === "completed";
  const column = completed ? "completed_at" : "last_active_at";
  const at = completed ? current.completedAt : current.lastActiveAt;
  if (!at) return { newerId: null, olderId: null };

  const base = () =>
    supabase
      .from("responses")
      .select("id")
      .eq("form_id", formId)
      .eq("status", completed ? "completed" : "partial");

  const [newer, older] = await Promise.all([
    base().gt(column, at).order(column, { ascending: true }).limit(1),
    base().lt(column, at).order(column, { ascending: false }).limit(1),
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
  /** Label of the question an unfinished respondent stopped on. */
  lastQuestionLabel: string | null;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  answers: {
    questionId: string;
    label: string;
    formatted: string;
    /** The raw stored answer (e.g. a contact block's field object). */
    value: unknown;
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
      "id, form_id, status, started_at, completed_at, last_active_at, last_question_id, ending_id, form_version_id, referrer, utm_source, utm_medium, utm_campaign, utm_term, utm_content",
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
      value: answersByQuestion.get(q.id),
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
    lastQuestionLabel: (() => {
      const q = schema.questions.find((x) => x.id === response.last_question_id);
      return q ? questionColumnLabel(q) : null;
    })(),
    referrer: response.referrer,
    utmSource: response.utm_source,
    utmMedium: response.utm_medium,
    utmCampaign: response.utm_campaign,
    utmTerm: response.utm_term,
    utmContent: response.utm_content,
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
  view: ResponseView = "completed",
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

  // PostgREST caps every request at max_rows (1000 by default, locally
  // and on hosted Supabase), so a single select would silently truncate
  // larger exports — page explicitly instead.
  const responses: {
    id: string;
    completed_at: string | null;
    last_active_at: string;
    ending_id: string | null;
    form_version_id: string;
    referrer: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_term: string | null;
    utm_content: string | null;
  }[] = [];
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await supabase
      .from("responses")
      .select(
        "id, completed_at, last_active_at, ending_id, form_version_id, referrer, utm_source, utm_medium, utm_campaign, utm_term, utm_content",
      )
      .eq("form_id", formId)
      .eq("status", view === "completed" ? "completed" : "partial")
      .order(view === "completed" ? "completed_at" : "last_active_at", {
        ascending: true,
      })
      .order("id", { ascending: true })
      .range(from, from + FETCH_PAGE - 1);
    if (error) throw error;
    responses.push(...data);
    if (responses.length > MAX_SYNCHRONOUS_EXPORT_ROWS) {
      throw new ExportTooLargeError(responses.length);
    }
    if (data.length < FETCH_PAGE) break;
  }

  const schemaCache = new Map<string, FormSchemaV1>();
  const answersByResponse = new Map<string, Map<string, unknown>>();
  const uploadNames = new Map<string, string>();

  // Batched by response id (not one query per response), and each batch
  // is itself paged since a batch can hold more than max_rows answers.
  for (let i = 0; i < responses.length; i += ID_BATCH) {
    const ids = responses.slice(i, i + ID_BATCH).map((r) => r.id);
    for (let from = 0; ; from += FETCH_PAGE) {
      const { data, error } = await supabase
        .from("answers")
        .select("response_id, question_id, value")
        .in("response_id", ids)
        .order("response_id")
        .order("question_id")
        .range(from, from + FETCH_PAGE - 1);
      if (error) throw error;
      for (const answer of data) {
        let byQuestion = answersByResponse.get(answer.response_id);
        if (!byQuestion) {
          byQuestion = new Map();
          answersByResponse.set(answer.response_id, byQuestion);
        }
        byQuestion.set(answer.question_id, answer.value);
      }
      if (data.length < FETCH_PAGE) break;
    }

    const { data: uploads, error: uploadsError } = await supabase
      .from("uploads")
      .select("id, original_filename")
      .in("response_id", ids)
      .limit(FETCH_PAGE);
    if (uploadsError) throw uploadsError;
    for (const upload of uploads) uploadNames.set(upload.id, upload.original_filename);
  }

  const rows: Record<string, unknown>[] = [];
  for (const response of responses) {
    const schema = await getSchemaForVersion(
      supabase,
      response.form_version_id,
      schemaCache,
    );
    const answersByQuestion = answersByResponse.get(response.id);

    const row: Record<string, unknown> =
      view === "completed"
        ? {
            "Submitted at": response.completed_at,
            Ending: schema?.endings.find((e) => e.id === response.ending_id)?.title ?? "",
          }
        : { "Last active": response.last_active_at };

    for (const refQuestion of referenceQuestions) {
      const ownQuestion =
        schema?.questions.find((q) => q.id === refQuestion.id) ?? refQuestion;
      const labels = questionColumnLabels(refQuestion);
      const cells = answerCells(
        refQuestion,
        ownQuestion,
        answersByQuestion?.get(refQuestion.id),
        { uploadNames },
      );
      labels.forEach((label, i) => (row[label] = cells[i]));
    }

    Object.assign(row, {
      Referrer: response.referrer ?? "",
      "UTM source": response.utm_source ?? "",
      "UTM medium": response.utm_medium ?? "",
      "UTM campaign": response.utm_campaign ?? "",
      "UTM term": response.utm_term ?? "",
      "UTM content": response.utm_content ?? "",
    });

    rows.push(row);
  }

  const columns = [
    ...(view === "completed" ? ["Submitted at", "Ending"] : ["Last active"]),
    ...referenceQuestions.flatMap(questionColumnLabels),
    ...ATTRIBUTION_COLUMNS,
  ];
  return toCsv(columns, rows);
}

export type DropoffStep = {
  questionId: string;
  label: string;
  /** Abandoned respondents whose last step was this question. */
  stopped: number;
};

/**
 * Where abandoned respondents stopped, in form order (latest version's
 * questions). Only sessions idle past the abandonment threshold count —
 * someone mid-answer hasn't dropped off. Aggregated in the database
 * (response_dropoff), scoped by RLS to the caller's forms.
 */
export async function getDropoff(
  supabase: Client,
  formId: string,
): Promise<{ steps: DropoffStep[]; total: number }> {
  const [{ data, error }, latest] = await Promise.all([
    supabase.rpc("response_dropoff", {
      target_form_id: formId,
      idle_minutes: ABANDONED_AFTER_MINUTES,
    }),
    getLatestSchema(supabase, formId),
  ]);
  if (error) throw error;

  const counts = new Map((data ?? []).map((row) => [row.question_id, row.stopped]));
  const steps = (latest?.questions ?? [])
    .filter((q) => q.type !== "welcome_screen")
    .map((q) => ({
      questionId: q.id,
      label: questionColumnLabel(q),
      stopped: counts.get(q.id) ?? 0,
    }));
  return { steps, total: steps.reduce((sum, s) => sum + s.stopped, 0) };
}
