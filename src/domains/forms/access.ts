import { signingKey } from "@/lib/crypto/keys";
import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/**
 * Password-protected forms (master spec F-48). One shared password per
 * form, which proves someone was given the password — never who they
 * are. The password is stored as a salted scrypt hash in
 * form_access_secrets, which only the server can read.
 *
 * Someone who enters it gets an httpOnly cookie for that form: an
 * expiry and an HMAC over the form id, the expiry and the current hash.
 * Changing or removing the password changes the hash, so every earlier
 * cookie stops working at once without keeping a list of sessions.
 */

export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./access-rules";
/** How long one unlock lasts at most: long enough to fill in a long
 * form. The cookie itself also ends when the browser closes (QA FC4-01:
 * a browser that had unlocked the form went straight in hours later). A
 * response started while unlocked can still be submitted after this. */
export const UNLOCK_TTL_SECONDS = 2 * 60 * 60;

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 } as const;

function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCallback(password, salt, keylen, options, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}

/** `scrypt$N$r$p$salt$hash`, base64url, so the cost can rise later
 * without breaking passwords set before. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, SCRYPT);
  return [
    "scrypt",
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash, ...rest] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash || rest.length > 0) return false;
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (![N, R, P].every(Number.isInteger)) return false;
  const expected = Buffer.from(hash, "base64url");
  try {
    const key = await scrypt(password, Buffer.from(salt, "base64url"), expected.length, {
      N,
      r: R,
      p: P,
    });
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

/** One cookie per form, so unlocking one form unlocks no other. */
export function unlockCookieName(formId: string): string {
  return `fc_unlock_${formId}`;
}

/** The unlock-signing key: its own, derived from APP_SECRET. */
function secretOrThrow(secret = process.env.APP_SECRET): Buffer {
  return signingKey("form-unlock", secret);
}

function sign(formId: string, expires: number, passwordHash: string, secret: Buffer) {
  return createHmac("sha256", secret)
    .update(`${formId}.${expires}.${passwordHash}`)
    .digest("base64url");
}

export function createUnlockToken(
  formId: string,
  passwordHash: string,
  options: { secret?: string; now?: number } = {},
): string {
  const expires = Math.floor((options.now ?? Date.now()) / 1000) + UNLOCK_TTL_SECONDS;
  return `${expires}.${sign(formId, expires, passwordHash, secretOrThrow(options.secret))}`;
}

export function verifyUnlockToken(
  token: string | null | undefined,
  formId: string,
  passwordHash: string,
  options: { secret?: string; now?: number } = {},
): boolean {
  const [expiresText, signature, ...rest] = (token ?? "").split(".");
  if (!expiresText || !signature || rest.length > 0) return false;
  const expires = Number(expiresText);
  if (!Number.isInteger(expires)) return false;
  if (expires <= Math.floor((options.now ?? Date.now()) / 1000)) return false;
  const expected = Buffer.from(
    sign(formId, expires, passwordHash, secretOrThrow(options.secret)),
  );
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The form's password hash, or null when it has no password. */
export async function getPasswordHash(
  admin: Client,
  formId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("form_access_secrets")
    .select("password_hash")
    .eq("form_id", formId)
    .maybeSingle();
  if (error) throw error;
  return data?.password_hash ?? null;
}

/** True when the form has no password, or this cookie unlocks it now. */
export async function isUnlocked(
  admin: Client,
  formId: string,
  cookie: string | null | undefined,
): Promise<boolean> {
  const hash = await getPasswordHash(admin, formId);
  return hash === null || verifyUnlockToken(cookie, formId, hash);
}

/** Sets, changes (null → removes) a form's password. Service role; the
 * caller has already checked the creator may change it. */
export async function setFormPassword(
  admin: Client,
  formId: string,
  password: string | null,
): Promise<void> {
  if (password === null) {
    const { error } = await admin
      .from("form_access_secrets")
      .delete()
      .eq("form_id", formId);
    if (error) throw error;
    return;
  }
  const { error } = await admin.from("form_access_secrets").upsert({
    form_id: formId,
    password_hash: await hashPassword(password),
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}
