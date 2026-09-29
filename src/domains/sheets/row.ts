import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { parseFormSchema } from "@/domains/forms/schema";
import type { AnswerMap } from "@/domains/logic";
import { formatAnswerValue, questionColumnLabel } from "@/domains/responses/format";

type Client = SupabaseClient<Database>;

export type SheetRow = { header: string[]; values: string[] };

/**
 * Builds the header + one data row for a just-completed response, the
 * same column set CSV export uses (the *latest* form_version's
 * questions, excluding welcome_screen/statement — see
 * "CSV export column set comes from the latest form_version" in
 * DECISIONS.md) so a form's Sheet and its CSV export never disagree
 * about columns. `answers` is the raw submitted map already in hand
 * at the call site (the /complete route), so this never re-queries
 * the `answers` table for data it was already given.
 */
export async function buildResponseRowForSheet(
  supabase: Client,
  formId: string,
  responseId: string,
  answers: AnswerMap,
  endingId: string | null,
): Promise<SheetRow> {
  const { data: latestVersion, error: latestVersionError } = await supabase
    .from("form_versions")
    .select("schema")
    .eq("form_id", formId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestVersionError) throw latestVersionError;

  const schema = latestVersion ? parseFormSchema(latestVersion.schema) : null;
  const referenceQuestions = (schema?.questions ?? []).filter(
    (q) => q.type !== "welcome_screen" && q.type !== "statement",
  );

  const { data: response } = await supabase
    .from("responses")
    .select("completed_at")
    .eq("id", responseId)
    .maybeSingle();

  const endingTitle = schema?.endings.find((e) => e.id === endingId)?.title ?? "";

  // File answers store an upload id; show the respondent's file name.
  const uploadNames = new Map<string, string>();
  if (referenceQuestions.some((q) => q.type === "file_upload")) {
    const { data: uploads } = await supabase
      .from("uploads")
      .select("id, original_filename")
      .eq("response_id", responseId);
    for (const upload of uploads ?? []) {
      uploadNames.set(upload.id, upload.original_filename);
    }
  }

  return {
    header: ["Submitted at", "Ending", ...referenceQuestions.map(questionColumnLabel)],
    values: [
      response?.completed_at ?? new Date().toISOString(),
      endingTitle,
      ...referenceQuestions.map((q) =>
        formatAnswerValue(q, answers[q.id], { uploadNames }),
      ),
    ],
  };
}
