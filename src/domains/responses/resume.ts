import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { CompiledFormV1 } from "@/domains/forms/schema/compile";
import { walkForm, type AnswerMap } from "@/domains/logic";

type Client = SupabaseClient<Database>;

/**
 * Resume links (PRD P2.8). The token is 256 random bits, shown only in
 * the link; the database keeps its SHA-256, so a leaked table can't be
 * turned into links. A link works while it's unexpired (30 days) and
 * unrevoked, the response is unfinished, the creator has the feature on
 * and the form hasn't been republished since. Resuming continues the
 * same response row, so submitting never makes a duplicate.
 * Service-role client only.
 */

export const RESUME_PARAM = "resume";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export class ResumeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResumeUnavailableError";
  }
}

/** A new link for an unfinished response: the path to share. */
export async function createResumeLink(
  admin: Client,
  responseId: string,
): Promise<{ path: string; expiresAt: string }> {
  const { data: response, error } = await admin
    .from("responses")
    .select("status, forms!inner(slug, resume_links_enabled, deleted_at)")
    .eq("id", responseId)
    .maybeSingle();
  if (error) throw error;
  const form = response?.forms as
    | { slug: string; resume_links_enabled: boolean; deleted_at: string | null }
    | undefined;
  if (!response || !form || form.deleted_at) {
    throw new ResumeUnavailableError("Response not found.");
  }
  if (!form.resume_links_enabled) {
    throw new ResumeUnavailableError("This form doesn't offer resume links.");
  }
  if (response.status === "completed") {
    throw new ResumeUnavailableError("This response is already submitted.");
  }

  const token = randomBytes(32).toString("base64url");
  const { data: row, error: insertError } = await admin
    .from("resume_tokens")
    .insert({ token_hash: hash(token), response_id: responseId })
    .select("expires_at")
    .single();
  if (insertError) throw insertError;
  return {
    path: `/f/${encodeURIComponent(form.slug)}?${RESUME_PARAM}=${token}`,
    expiresAt: row.expires_at,
  };
}

export type ResumedResponse = {
  responseId: string;
  formVersionId: string;
  revision: number;
  answers: AnswerMap;
  lastQuestionId: string;
  history: string[];
  hidden: Record<string, string>;
  seed?: string;
};

export type ResumeResult =
  | { ok: true; response: ResumedResponse }
  | { ok: false; reason: "invalid" | "expired" | "submitted" | "changed" | "disabled" };

/** What a resume link opens, for this form's currently published
 * version. Never throws for a bad token: the page just starts fresh. */
export async function resolveResumeToken(
  admin: Client,
  token: string,
  form: { formId: string; formVersionId: string; compiled: CompiledFormV1 },
  now = new Date(),
): Promise<ResumeResult> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { ok: false, reason: "invalid" };
  const { data: row } = await admin
    .from("resume_tokens")
    .select("response_id, expires_at, revoked_at")
    .eq("token_hash", hash(token))
    .maybeSingle();
  if (!row) return { ok: false, reason: "invalid" };

  const { data: response } = await admin
    .from("responses")
    .select(
      "id, form_id, form_version_id, status, client_revision, last_question_id, hidden_fields, random_seed, forms!inner(resume_links_enabled)",
    )
    .eq("id", row.response_id)
    .maybeSingle();
  if (!response || response.form_id !== form.formId)
    return { ok: false, reason: "invalid" };
  if (response.status === "completed") return { ok: false, reason: "submitted" };
  if (row.revoked_at) return { ok: false, reason: "invalid" };
  if (new Date(row.expires_at) <= now) return { ok: false, reason: "expired" };
  if (!(response.forms as { resume_links_enabled: boolean }).resume_links_enabled) {
    return { ok: false, reason: "disabled" };
  }
  if (response.form_version_id !== form.formVersionId)
    return { ok: false, reason: "changed" };

  const { data: rows, error } = await admin
    .from("answers")
    .select("question_id, value")
    .eq("response_id", response.id);
  if (error) throw error;
  const answers: AnswerMap = Object.fromEntries(
    (rows ?? []).map((a) => [a.question_id, a.value]),
  );
  const hidden = Object.fromEntries(
    Object.entries((response.hidden_fields ?? {}) as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );

  // Back navigation: the path the engine takes to where they stopped.
  const seed = response.random_seed ?? undefined;
  const visited = walkForm(form.compiled, answers, {
    hidden,
    now,
    seed,
  }).visitedQuestionIds;
  const last =
    response.last_question_id && visited.includes(response.last_question_id)
      ? response.last_question_id
      : (visited.at(-1) ?? form.compiled.orderedQuestionIds[0]);
  return {
    ok: true,
    response: {
      responseId: response.id,
      formVersionId: response.form_version_id,
      revision: response.client_revision,
      answers,
      lastQuestionId: last,
      history: visited.slice(0, visited.indexOf(last)),
      hidden,
      seed,
    },
  };
}
