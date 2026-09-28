/**
 * Minimal magic-byte content-type sniffing for the file types Phase 1
 * actually needs to accept (images + PDF). This is the "never rely on
 * the browser-supplied MIME type alone" check — a respondent's browser
 * declares a `Content-Type` on the upload, but that's just a string
 * the client chose; the bytes are the only thing we can trust. Covers
 * the accepted-type space intentionally, not every file format that
 * exists — an unrecognized signature is rejected outright rather than
 * falling back to trusting the declared type.
 */

export type SniffedType = {
  mimeType: string;
  extension: string;
};

const SIGNATURES: {
  mimeType: string;
  extension: string;
  check: (bytes: Uint8Array) => boolean;
}[] = [
  {
    mimeType: "image/png",
    extension: "png",
    check: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    mimeType: "image/jpeg",
    extension: "jpg",
    check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mimeType: "image/gif",
    extension: "gif",
    check: (b) =>
      b[0] === 0x47 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x38 &&
      (b[4] === 0x37 || b[4] === 0x39) &&
      b[5] === 0x61,
  },
  {
    mimeType: "image/webp",
    extension: "webp",
    check: (b) =>
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  },
  {
    mimeType: "application/pdf",
    extension: "pdf",
    check: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
  },
];

/** Returns the actual sniffed type, or null if the bytes don't match
 * any type this app accepts anywhere (a disguised/unsupported file). */
export function sniffContentType(bytes: Uint8Array): SniffedType | null {
  for (const sig of SIGNATURES) {
    if (bytes.length >= 12 && sig.check(bytes)) {
      return { mimeType: sig.mimeType, extension: sig.extension };
    }
  }
  return null;
}

/** Matches a sniffed mime type against a question's configured accept
 * list, which may contain exact types ("application/pdf") or wildcard
 * groups ("image/*"). */
export function matchesAcceptedTypes(mimeType: string, accepted: string[]): boolean {
  return accepted.some((pattern) => {
    if (pattern === "*/*") return true;
    if (pattern.endsWith("/*")) return mimeType.startsWith(pattern.slice(0, -1));
    return pattern === mimeType;
  });
}
