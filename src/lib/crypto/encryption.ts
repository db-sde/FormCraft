import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { currentEncryptionKey, encryptionKeyById, LEGACY_KEY_ID } from "./keys";

/**
 * Encrypting stored secrets (provider keys, OAuth tokens, lookup
 * headers) with AES-256-GCM. Each value records its key id (rotation, see
 * keys.ts) and is bound to where it's stored — `context`, e.g.
 * "credential:<workspace>:stripe" — as associated data, so a value copied
 * into another workspace's row won't decrypt there.
 */

export type EncryptedPayload = {
  /** 2: key id and context. Absent: before either (legacy). */
  v?: 2;
  kid?: string;
  iv: string;
  authTag: string;
  ciphertext: string;
};

export function encryptJson(value: unknown, context?: string): EncryptedPayload {
  const { id, key } = currentEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`formcraft:v2:${context ?? ""}`, "utf8"));
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    v: 2,
    kid: id,
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptJson<T>(payload: EncryptedPayload, context?: string): T {
  const legacy = payload.v !== 2;
  const key = encryptionKeyById(legacy ? LEGACY_KEY_ID : (payload.kid ?? ""));
  if (!key) throw new Error(`No encryption key "${payload.kid ?? ""}" to decrypt with`);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(payload.iv, "base64"),
  );
  if (!legacy) decipher.setAAD(Buffer.from(`formcraft:v2:${context ?? ""}`, "utf8"));
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

/** Whether a value should be rewritten: legacy, or not under the
 * current key. */
export function needsReencryption(payload: EncryptedPayload): boolean {
  return payload.v !== 2 || payload.kid !== currentEncryptionKey().id;
}
