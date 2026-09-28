import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encrypts OAuth tokens before they're ever written to
 * `sheets_connections.encrypted_tokens` (see that column's comment in
 * the migration — never raw tokens at rest). AES-256-GCM with a fresh
 * random IV per encryption and the GCM auth tag stored alongside the
 * ciphertext, so tampering with a stored row is detected on decrypt
 * rather than silently producing garbage tokens.
 *
 * The key is derived from APP_SECRET (already used elsewhere in this
 * app as the one server-only secret — see .env.example) via SHA-256,
 * which always yields exactly the 32 bytes AES-256 needs regardless of
 * the raw secret's length.
 */
function deriveKey(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret) {
    throw new Error("APP_SECRET is not set — required to encrypt/decrypt Sheets tokens");
  }
  return createHash("sha256").update(secret).digest();
}

export type EncryptedPayload = {
  iv: string;
  authTag: string;
  ciphertext: string;
};

export function encryptJson(value: unknown): EncryptedPayload {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptJson<T>(payload: EncryptedPayload): T {
  const key = deriveKey();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(payload.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
