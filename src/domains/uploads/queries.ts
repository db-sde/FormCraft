import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
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

const HARD_MAX_BYTES = 100 * 1024 * 1024; // absolute ceiling regardless of question config

/**
 * Validates and stores a respondent file upload. The response must
 * already exist and be non-completed (uploads only ever happen while
 * filling out the form); the question's own `acceptedMimeTypes`/
 * `maxSizeMb` settings (from the published schema, never the client)
 * are the source of truth for limits. Content type is sniffed from the
 * actual bytes, not trusted from the browser's declared type — see
 * sniff.ts.
 */
export async function recordUpload(
  admin: Client,
  responseId: string,
  questionId: string,
  file: { bytes: Uint8Array; originalFilename: string },
): Promise<{ uploadId: string }> {
  if (file.bytes.byteLength > HARD_MAX_BYTES) {
    throw new FileTooLargeError(HARD_MAX_BYTES / (1024 * 1024));
  }

  const { data: response, error: responseError } = await admin
    .from("responses")
    .select("form_version_id")
    .eq("id", responseId)
    .maybeSingle();
  if (responseError) throw responseError;
  if (!response) throw new ResponseNotFoundError();

  const { data: versionRow, error: versionError } = await admin
    .from("form_versions")
    .select("schema")
    .eq("id", response.form_version_id)
    .single();
  if (versionError) throw versionError;
  const compiled = compileFormSchema(parseFormSchema(versionRow.schema));

  const question = compiled.schema.questions.find((q) => q.id === questionId);
  if (!question || question.type !== "file_upload") throw new QuestionNotFoundError();

  if (file.bytes.byteLength > question.settings.maxSizeMb * 1024 * 1024) {
    throw new FileTooLargeError(question.settings.maxSizeMb);
  }

  const sniffed = sniffContentType(file.bytes);
  if (
    !sniffed ||
    !matchesAcceptedTypes(sniffed.mimeType, question.settings.acceptedMimeTypes)
  ) {
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
  if (insertError) throw insertError;

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
