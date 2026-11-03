import { createHash, hkdfSync } from "node:crypto";

/**
 * Keys (hardening, 2026-11-03). Two separate things used to share one
 * secret: encrypting stored credentials and signing short-lived tokens.
 *
 * - Signing: each purpose (OAuth state, PKCE, form unlocks) gets its own
 *   key, derived from APP_SECRET with HKDF, so a key recovered from one
 *   use can't forge another.
 * - Encryption: ENCRYPTION_KEYS — `id:base64key[,id:base64key…]`, 32-byte
 *   keys, the first one current. Every value records the id of the key
 *   that encrypted it, so a key can be rotated: add a new first key, run
 *   `npm run secrets:reencrypt`, then drop the old one. Without
 *   ENCRYPTION_KEYS a key derived from APP_SECRET is used (id "app").
 *   Values written before key ids existed (no id) are read with the old
 *   derivation, sha256(APP_SECRET), and rewritten by the re-encrypt job.
 */

export type SigningPurpose =
  "connect-state" | "connect-pkce" | "sheets-state" | "sheets-pkce" | "form-unlock";

function appSecret(value = process.env.APP_SECRET): string {
  if (!value) throw new Error("APP_SECRET is not set");
  return value;
}

/** The signing key for one purpose. `secret` overrides APP_SECRET
 * (tests). */
export function signingKey(purpose: SigningPurpose, secret?: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", appSecret(secret), "formcraft-signing", purpose, 32),
  );
}

export type EncryptionKey = { id: string; key: Buffer };

export const LEGACY_KEY_ID = "legacy";

function parseKeys(raw: string): EncryptionKey[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, b64] = entry.split(":");
      const key = Buffer.from(b64 ?? "", "base64");
      if (!id || !/^[A-Za-z0-9_-]{1,32}$/.test(id) || id === LEGACY_KEY_ID) {
        throw new Error(`ENCRYPTION_KEYS: bad key id "${id ?? ""}"`);
      }
      if (key.length !== 32) {
        throw new Error(`ENCRYPTION_KEYS: key "${id}" must be 32 bytes (base64)`);
      }
      return { id, key };
    });
}

/** Every key that can decrypt, current first. */
export function encryptionKeys(): EncryptionKey[] {
  const configured = process.env.ENCRYPTION_KEYS?.trim();
  const keys = configured ? parseKeys(configured) : [];
  if (!keys.length) {
    keys.push({
      id: "app",
      key: Buffer.from(
        hkdfSync("sha256", appSecret(), "formcraft-encryption", "data", 32),
      ),
    });
  }
  return keys;
}

export function currentEncryptionKey(): EncryptionKey {
  return encryptionKeys()[0];
}

export function encryptionKeyById(id: string): Buffer | null {
  if (id === LEGACY_KEY_ID) return legacyKey();
  return encryptionKeys().find((k) => k.id === id)?.key ?? null;
}

/** How values were encrypted before key ids. */
export function legacyKey(): Buffer {
  return createHash("sha256").update(appSecret()).digest();
}
