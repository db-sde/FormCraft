import { scanBytes } from "./scan";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getWorkspacePlan, type Entitlements } from "@/domains/billing/entitlements";
import { firstTimeThisMonth } from "@/domains/billing/quotas";
import { defaultSender } from "@/domains/notifications/mailer";
import { renderEmailHtml } from "@/domains/notifications/email-layout";
import { compileFormSchema, parseFormSchema } from "@/domains/forms/schema";
import { sniffContentType, matchesAcceptedTypes, mediaMimeType } from "./sniff";

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

/** The malware scanner flagged the file. */
export class InfectedFileError extends Error {
  constructor(public readonly signature: string) {
    super("this file was flagged as unsafe");
    this.name = "InfectedFileError";
  }
}

/** A malware scanner is configured but couldn't check the file. */
export class ScanUnavailableError extends Error {
  constructor(reason: string) {
    super(`the file couldn't be checked: ${reason}`);
    this.name = "ScanUnavailableError";
  }
}

/** The workspace's plan storage is full (pricing doc: enforced at upload). */
export class StorageFullError extends Error {
  constructor() {
    super("the form's storage is full");
    this.name = "StorageFullError";
  }
}

export class ResponseCompletedError extends Error {
  constructor() {
    super("this response was already submitted");
    this.name = "ResponseCompletedError";
  }
}

const HARD_MAX_BYTES = 100 * 1024 * 1024; // absolute ceiling regardless of question config
/** A drawn or typed signature, as a PNG: a few tens of KB in practice. */
export const SIGNATURE_MAX_BYTES = 512 * 1024;

export type PreparedUpload = {
  responseId: string;
  questionId: string;
  maxBytes: number;
  acceptedMimeTypes: string[];
  /** A recorded answer (roadmap #21): the kind the question asks for. */
  mediaKind?: "audio" | "video";
  /** For the storage warnings after the file is stored. */
  workspaceId?: string;
  entitlements?: Entitlements;
};

/**
 * The most a recording of this length may weigh: generous bit rates
 * (256 kbit/s audio, 4 Mbit/s video) plus a little for the container.
 * The browser stops recording at the question's limit; this is the
 * server's own cap, since a recording's length can't be trusted.
 */
export function mediaMaxBytes(kind: "audio" | "video", maxSeconds: number): number {
  const perSecond = kind === "video" ? 512 * 1024 : 32 * 1024;
  return Math.min(maxSeconds * perSecond + 512 * 1024, HARD_MAX_BYTES);
}

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
  if (
    !question ||
    (question.type !== "file_upload" &&
      question.type !== "signature" &&
      question.type !== "media")
  )
    throw new QuestionNotFoundError();

  // The plan's storage (pricing doc: enforced at upload time): a file may
  // use what's left of it, and none is taken once it's full.
  const workspaceId = (response.forms as { workspace_id: string } | null)?.workspace_id;
  const entitlements = workspaceId
    ? (await getWorkspacePlan(admin, workspaceId)).entitlements
    : null;
  let storageLeft = HARD_MAX_BYTES;
  if (workspaceId && entitlements?.storage_mb != null) {
    const { data: used } = await admin.rpc("workspace_storage_bytes", {
      p_workspace_id: workspaceId,
    });
    storageLeft = entitlements.storage_mb * 1024 * 1024 - Number(used ?? 0);
    if (storageLeft <= 0) throw new StorageFullError();
  }
  const base = {
    responseId,
    questionId,
    workspaceId,
    entitlements: entitlements ?? undefined,
  };

  // A signature (F-10) is a small PNG the browser drew; nothing else.
  if (question.type === "signature") {
    return {
      ...base,
      maxBytes: Math.min(SIGNATURE_MAX_BYTES, storageLeft),
      acceptedMimeTypes: ["image/png"],
    };
  }

  // A recording: its size follows from its length, which the plan caps
  // too (1 / 3 / 10 minutes).
  if (question.type === "media") {
    const planSeconds = entitlements?.recording_seconds;
    const seconds =
      planSeconds == null
        ? question.settings.maxSeconds
        : Math.min(question.settings.maxSeconds, planSeconds);
    return {
      ...base,
      maxBytes: Math.min(mediaMaxBytes(question.settings.kind, seconds), storageLeft),
      acceptedMimeTypes: [`${question.settings.kind}/*`],
      mediaKind: question.settings.kind,
    };
  }

  // The plan's per-file ceiling applies on top of the question's own.
  const planMb = entitlements?.upload_mb ?? null;
  return {
    ...base,
    maxBytes: Math.min(
      question.settings.maxSizeMb * 1024 * 1024,
      planMb === null ? HARD_MAX_BYTES : planMb * 1024 * 1024,
      HARD_MAX_BYTES,
      storageLeft,
    ),
    acceptedMimeTypes: question.settings.acceptedMimeTypes,
  };
}

/**
 * Tells the workspace owner when its files reach 80% and 95% of the
 * plan's storage, once each a month. Never throws (the file is stored).
 */
export async function warnIfStorageHigh(
  admin: Client,
  workspaceId: string,
  entitlements: Entitlements,
): Promise<void> {
  try {
    const limitMb = entitlements.storage_mb;
    if (limitMb === null) return;
    const { data: used } = await admin.rpc("workspace_storage_bytes", {
      p_workspace_id: workspaceId,
    });
    const share = Number(used ?? 0) / (limitMb * 1024 * 1024);
    const level = share >= 0.95 ? 95 : share >= 0.8 ? 80 : null;
    if (!level) return;
    if (!(await firstTimeThisMonth(admin, workspaceId, `storage_${level}`))) return;
    const send = defaultSender();
    const { data: ws } = await admin
      .from("workspaces")
      .select("name, owner:profiles!workspaces_owner_id_fkey(email)")
      .eq("id", workspaceId)
      .maybeSingle();
    const to = (ws?.owner as { email: string | null } | null)?.email;
    if (!send || !ws || !to) return;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const body =
      level === 95
        ? `${ws.name} has used ${Math.round(share * 100)}% of its ${limitMb / 1000} GB of file storage. When it's full, forms stop accepting new files (answers are still saved). Delete old files or upgrade to keep them coming.`
        : `${ws.name} has used ${Math.round(share * 100)}% of its ${limitMb / 1000} GB of file storage.`;
    await send({
      to: [to],
      subject: `File storage ${level}% used in ${ws.name}`,
      text: `${body}

See usage: ${appUrl}/settings`,
      html: renderEmailHtml({
        tag: "Storage",
        tagColor: level === 95 ? "#f8e1dd" : "#fdf0d5",
        title: `File storage ${level}% used`,
        body,
        button: { label: "See your plan and usage", href: `${appUrl}/settings` },
        fine: "Sent once at 80% and once at 95% each month.",
      }),
    });
  } catch {
    // A warning never affects the upload.
  }
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
 * With a malware scanner configured (CLAMD_HOST, see scan.ts) every
 * file is scanned before it's stored: flagged files are refused, and so
 * are files the scanner couldn't check. Without one, files are recorded
 * as "clean" unscanned (DECISIONS.md).
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

  const sniffed = context.mediaKind
    ? mediaMimeType(sniffContentType(file.bytes), context.mediaKind)
    : sniffContentType(file.bytes);
  if (!sniffed || !matchesAcceptedTypes(sniffed.mimeType, context.acceptedMimeTypes)) {
    throw new UnsupportedFileTypeError();
  }

  const scan = await scanBytes(file.bytes);
  if (scan.status === "infected") throw new InfectedFileError(scan.signature);
  if (scan.status === "unavailable") throw new ScanUnavailableError(scan.reason);

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

  if (context.workspaceId && context.entitlements) {
    await warnIfStorageHigh(admin, context.workspaceId, context.entitlements);
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
  /** Served as a download under this name (Content-Disposition:
   * attachment), never rendered in the browser: a respondent's file is
   * hostile until proven otherwise. */
  downloadName = true as string | true,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("response-uploads")
    .createSignedUrl(storagePath, expiresInSeconds, { download: downloadName });
  if (error) return null;
  return data.signedUrl;
}
