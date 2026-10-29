import { describe, expect, it } from "vitest";
import {
  createUnlockToken,
  hashPassword,
  UNLOCK_TTL_SECONDS,
  unlockCookieName,
  verifyPassword,
  verifyUnlockToken,
} from "@/domains/forms/access";

const secret = "test-secret";
const formId = "11111111-1111-4111-8111-111111111111";

describe("form passwords (F-48)", () => {
  it("stores a salted hash, never the password", async () => {
    const a = await hashPassword("open sesame");
    const b = await hashPassword("open sesame");
    expect(a).not.toContain("open sesame");
    expect(a).toMatch(/^scrypt\$16384\$8\$1\$[\w-]+\$[\w-]+$/);
    // A fresh salt each time.
    expect(a).not.toBe(b);
  });

  it("accepts the right password and refuses anything else", async () => {
    const stored = await hashPassword("open sesame");
    expect(await verifyPassword("open sesame", stored)).toBe(true);
    expect(await verifyPassword("open sesame ", stored)).toBe(false);
    expect(await verifyPassword("Open sesame", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("refuses a malformed or tampered hash instead of throwing", async () => {
    const stored = await hashPassword("pw12");
    expect(await verifyPassword("pw12", "plain-text")).toBe(false);
    expect(await verifyPassword("pw12", stored.replace("scrypt", "md5"))).toBe(false);
    expect(await verifyPassword("pw12", `${stored}$extra`)).toBe(false);
    expect(await verifyPassword("pw12", stored.replace("$16384$", "$abc$"))).toBe(false);
  });
});

describe("unlock cookie (F-48)", () => {
  const hash = "scrypt$16384$8$1$salt$hash";
  const now = Date.UTC(2026, 9, 28, 12);

  it("is per form", () => {
    expect(unlockCookieName(formId)).toBe(`fc_unlock_${formId}`);
  });

  it("unlocks the form it was made for until it expires", () => {
    const token = createUnlockToken(formId, hash, { secret, now });
    expect(verifyUnlockToken(token, formId, hash, { secret, now })).toBe(true);
    const later = now + (UNLOCK_TTL_SECONDS - 1) * 1000;
    expect(verifyUnlockToken(token, formId, hash, { secret, now: later })).toBe(true);
    const expired = now + UNLOCK_TTL_SECONDS * 1000;
    expect(verifyUnlockToken(token, formId, hash, { secret, now: expired })).toBe(false);
  });

  it("stops working when the password changes", () => {
    const token = createUnlockToken(formId, hash, { secret, now });
    expect(verifyUnlockToken(token, formId, `${hash}x`, { secret, now })).toBe(false);
  });

  it("can't be moved to another form, forged or stretched", () => {
    const token = createUnlockToken(formId, hash, { secret, now });
    const other = "22222222-2222-4222-8222-222222222222";
    expect(verifyUnlockToken(token, other, hash, { secret, now })).toBe(false);
    expect(verifyUnlockToken(token, formId, hash, { secret: "other", now })).toBe(false);
    const [expires, signature] = token.split(".");
    // A later expiry with the old signature.
    expect(
      verifyUnlockToken(`${Number(expires) + 3600}.${signature}`, formId, hash, {
        secret,
        now,
      }),
    ).toBe(false);
    for (const bad of [undefined, null, "", "abc", `${expires}.`, `${token}.x`]) {
      expect(verifyUnlockToken(bad, formId, hash, { secret, now })).toBe(false);
    }
  });
});
