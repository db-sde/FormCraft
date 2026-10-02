import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getWorkspacePlan } from "@/domains/billing/entitlements";
import { compileFormSchema, parseFormSchema } from "@/domains/forms/schema";
import { sniffContentType, matchesAcceptedTypes } from "./sniff";

type Client = SupabaseClient<Database>;

export class ResponseNotFoundError extends Error {
  constructor() {
    super("response not found");
    this.name = "ResponseNotFoundError";
  }
}

export class QuestionNotFoundError extends Error {
  constructor() {
    super("question not found on this form");
    this.name = "QuestionNotFoundError";
  }
}

export class UnsupportedFileTypeError extends Error {
  constructor() {
    super("this file type isn't supported");
    this.name = "UnsupportedFileTypeError";
  }
}

export class FileTooLargeError extends Error {
  constructor(public readonly maxSizeMb: number) {
    super(`file exceeds the ${maxSizeMb}MB limit`);
    this.name = "FileTooLargeError";
  }
}

export class ResponseCompletedError extends Error {
  constructor() {
    super("this response was already submitted");
    this.name = "ResponseCompletedError";
  }
}

const HARD_MAX_BYTES = 100 * 1024 * 1024; // absolute ceiling regardless of question config

export type PreparedUpload = {
  responseId: string;
  questionId: string;
  maxBytes: number;
  acceptedMimeTypes: string[];
};

/**
 * Everything that can be decided before reading a single byte of the
 * file: the response exists and is still being filled in (a submitted
 * response must not gain files), the question is a file question of
 * its form, and what its size and type limits are. The route uses
 * `maxBytes` to refuse an oversized body up front, before it's buffered
 * into memory.
 */
export async function prepareUpload(
  admin: Client,
  responseId: string,
  questionId: string,
): Promise<PreparedUpload> {
  const { data: response, error: responseError } = await admin
    .from("responses")
    .select("form_version_id, status, forms(workspace_id)")
    .eq("id", responseId)
    .maybeSingle();
  if (responseError) throw responseError;
  if (!response) throw new ResponseNotFoundError();
  if (response.status === "completed") throw new ResponseCompletedError();

  const { data: versionRow, error: versionError } = await admin
    .from("form_versions")
    .select("schema")
    .eq("id", response.form_version_id)
    .single();
  if (versionError) throw versionError;
  const compiled = compileFormSchema(parseFormSchema(versionRow.schema));

  const question = compiled.schema.questions.find((q) => q.id === questionId);
  if (!question || question.type !== "file_upload") throw new QuestionNotFoundError();

  // The plan's per-file ceiling applies on top of the question's own.
  const workspaceId = (response.forms as { workspace_id: string } | null)?.workspace_id;
  const planMb = workspaceId
    ? (await getWorkspacePlan(admin, workspaceId)).entitlements.upload_mb
    : null;

  return {
    responseId,
    questionId,
    maxBytes: Math.min(
      question.settings.maxSizeMb * 1024 * 1024,
      planMb === null ? HARD_MAX_BYTES : planMb * 1024 * 1024,
      HARD_MAX_BYTES,
    ),
    acceptedMimeTypes: question.settings.acceptedMimeTypes,
  };
}

/**
 * Validates and stores a respondent file upload against a prepared
 * context. The question's own `acceptedMimeTypes`/`maxSizeMb` settings
 * (from the published schema, never the client) are the source of
 * truth for limits. Content type is sniffed from the actual bytes, not
 * trusted from the browser's declared type — see sniff.ts. A new file
 * for the same question replaces the previous one (rows and storage
 * objects), so resuming and re-uploading doesn't accumulate files.
 *
 * Files are recorded as "clean" without a malware scan — see
 * DECISIONS.md; a scanner must sit between this and "clean" before
 * accepting untrusted uploads at scale.
 */
export async function recordUpload(
  admin: Client,
  responseId: string,
  questionId: string,
  file: { bytes: Uint8Array; originalFilename: string },
  prepared?: PreparedUpload,
): Promise<{ uploadId: string }> {
  const context = prepared ?? (await prepareUpload(admin, responseId, questionId));

  if (file.bytes.byteLength > context.maxBytes) {
    throw new FileTooLargeError(Math.floor(context.maxBytes / (1024 * 1024)));
  }

  const sniffed = sniffContentType(file.bytes);
  if (!sniffed || !matchesAcceptedTypes(sniffed.mimeType, context.acceptedMimeTypes)) {
    throw new UnsupportedFileTypeError();
  }

  const storagePath = `${responseId}/${questionId}/${crypto.randomUUID()}.${sniffed.extension}`;

  const { error: uploadError } = await admin.storage
    .from("response-uploads")
    .upload(storagePath, file.bytes, { contentType: sniffed.mimeType, upsert: false });
  if (uploadError) throw uploadError;

  const { data: row, error: insertError } = await admin
    .from("uploads")
    .insert({
      response_id: responseId,
      question_id: questionId,
      storage_path: storagePath,
      original_filename: file.originalFilename.slice(0, 255),
      mime_type: sniffed.mimeType,
      size_bytes: file.bytes.byteLength,
      status: "clean",
    })
    .select("id")
    .single();
  if (insertError) {
    await admin.storage.from("response-uploads").remove([storagePath]);
    throw insertError;
  }

  // Replace any earlier file for this question.
  const { data: previous } = await admin
    .from("uploads")
    .select("id, storage_path")
    .eq("response_id", responseId)
    .eq("question_id", questionId)
    .neq("id", row.id);
  if (previous?.length) {
    await admin.storage
      .from("response-uploads")
      .remove(previous.map((u) => u.storage_path));
    await admin
      .from("uploads")
      .delete()
      .in(
        "id",
        previous.map((u) => u.id),
      );
  }

  return { uploadId: row.id };
}

/** A short-lived signed URL for the creator dashboard to view/download
 * an uploaded file — the bucket is private, so this is the only way to
 * actually see the content (see storage_buckets migration). Called
 * with the caller's own session-scoped client, whose RLS already
 * restricts which storage objects it can generate a signed URL for to
 * ones belonging to a response in the caller's own workspace. */
export async function getUploadSignedUrl(
  supabase: Client,
  storagePath: string,
  expiresInSeconds = 3600,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("response-uploads")
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error) return null;
  return data.signedUrl;
}
