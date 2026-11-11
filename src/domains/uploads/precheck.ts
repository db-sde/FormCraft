/**
 * The respondent's browser checks a file against the question's limits
 * before uploading it, so a file that's too big or of the wrong kind is
 * turned down at once, with the reason. The server checks again (and
 * sniffs the real type); its refusals map to the same messages.
 */

export type UploadLimits = { acceptedMimeTypes: string[]; maxSizeMb: number };

/** "Images, PDF files" for ["image/*", "application/pdf"]. */
export function describeAcceptedTypes(mimeTypes: string[]): string {
  return mimeTypes
    .map((t) => {
      if (t === "image/*") return "Images";
      if (t === "application/pdf") return "PDF files";
      if (t.endsWith("/*")) return `${t.slice(0, -2)} files`;
      return t.split("/")[1]?.toUpperCase() ?? t;
    })
    .join(", ");
}

export const EMPTY_FILE_MESSAGE = "This file is empty. Choose another one.";

export function tooLargeMessage(maxSizeMb: number): string {
  return `That file is larger than ${maxSizeMb} MB. Choose a smaller one.`;
}

export function wrongTypeMessage(mimeTypes: string[]): string {
  return `That kind of file can't be uploaded here. Allowed: ${describeAcceptedTypes(mimeTypes)}.`;
}

function typeAllowed(type: string, accepted: string[]): boolean {
  return accepted.some((a) =>
    a.endsWith("/*") ? type.startsWith(a.slice(0, -1)) : type === a,
  );
}

/** Null when the file may be uploaded; otherwise why not. A file whose
 * type the browser doesn't know is left for the server to judge. */
export function precheckUpload(
  file: { size: number; type: string },
  limits: UploadLimits,
): string | null {
  // Empty, then size, then type: each with its own reason (QA FC4-23).
  if (file.size === 0) return EMPTY_FILE_MESSAGE;
  if (file.size > limits.maxSizeMb * 1024 * 1024)
    return tooLargeMessage(limits.maxSizeMb);
  if (file.type && !typeAllowed(file.type, limits.acceptedMimeTypes)) {
    return wrongTypeMessage(limits.acceptedMimeTypes);
  }
  return null;
}

/** The message for a refused upload, from the server's error code. */
export function uploadRefusalMessage(
  code: string | undefined,
  limits: UploadLimits,
): string {
  if (code === "empty") return EMPTY_FILE_MESSAGE;
  if (code === "too_large") return tooLargeMessage(limits.maxSizeMb);
  if (code === "unsupported_type") return wrongTypeMessage(limits.acceptedMimeTypes);
  return "The upload failed. Try again.";
}
