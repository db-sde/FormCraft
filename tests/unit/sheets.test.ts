import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { encryptJson, decryptJson } from "@/domains/sheets/crypto";
import {
  buildAuthorizeUrl,
  isGoogleOAuthConfigured,
  needsRefresh,
  exchangeCodeForTokens,
  refreshAccessToken,
} from "@/domains/sheets/oauth";
import { appendRowToSheet, SheetsApiError } from "@/domains/sheets/append";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.APP_SECRET = "test-secret-do-not-use-in-prod";
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
  process.env.GOOGLE_OAUTH_REDIRECT_URI = "http://localhost:3000/api/integrations/google/callback";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe("encryptJson / decryptJson", () => {
  it("round-trips a token payload exactly", () => {
    const tokens = { accessToken: "at_123", refreshToken: "rt_456", expiresAt: 1234567890 };
    const encrypted = encryptJson(tokens);
    expect(decryptJson(encrypted)).toEqual(tokens);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const tokens = { a: 1 };
    const first = encryptJson(tokens);
    const second = encryptJson(tokens);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.iv).not.toBe(second.iv);
  });

  it("fails to decrypt if the ciphertext was tampered with", () => {
    const encrypted = encryptJson({ secret: "value" });
    const tampered = { ...encrypted, ciphertext: Buffer.from("tampered").toString("base64") };
    expect(() => decryptJson(tampered)).toThrow();
  });

  it("throws if APP_SECRET is not set", () => {
    delete process.env.APP_SECRET;
    expect(() => encryptJson({ a: 1 })).toThrow(/APP_SECRET/);
  });
});

describe("isGoogleOAuthConfigured", () => {
  it("is true when all three env vars are set", () => {
    expect(isGoogleOAuthConfigured()).toBe(true);
  });

  it("is false when any one is missing", () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    expect(isGoogleOAuthConfigured()).toBe(false);
  });
});

describe("buildAuthorizeUrl", () => {
  it("includes the client id, redirect uri, sheets scope, and state", () => {
    const url = new URL(buildAuthorizeUrl("form_123"));
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/integrations/google/callback",
    );
    expect(url.searchParams.get("scope")).toContain("spreadsheets");
    expect(url.searchParams.get("state")).toBe("form_123");
    // Required so a reconnect after a revoke still gets a refresh token.
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("throws when Google OAuth isn't configured", () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    expect(() => buildAuthorizeUrl("form_123")).toThrow();
  });
});

describe("needsRefresh", () => {
  it("is true once fewer than 2 minutes remain", () => {
    expect(needsRefresh(Date.now() + 60_000)).toBe(true);
    expect(needsRefresh(Date.now() - 1000)).toBe(true);
  });

  it("is false with plenty of time left", () => {
    expect(needsRefresh(Date.now() + 10 * 60_000)).toBe(false);
  });
});

describe("exchangeCodeForTokens / refreshAccessToken (against a fake token endpoint)", () => {
  it("parses a successful token exchange response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            access_token: "at_abc",
            refresh_token: "rt_xyz",
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      ),
    );

    const tokens = await exchangeCodeForTokens("auth-code", "https://fake.test/token");
    expect(tokens.accessToken).toBe("at_abc");
    expect(tokens.refreshToken).toBe("rt_xyz");
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
  });

  it("throws with Google's error description when the exchange fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ error: "invalid_grant", error_description: "Bad code" }),
          { status: 400 },
        ),
      ),
    );

    await expect(exchangeCodeForTokens("bad-code", "https://fake.test/token")).rejects.toThrow(
      "Bad code",
    );
  });

  it("throws if Google omits a refresh token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ access_token: "at_abc", expires_in: 3600 }), {
          status: 200,
        }),
      ),
    );

    await expect(exchangeCodeForTokens("code", "https://fake.test/token")).rejects.toThrow(
      /refresh token/,
    );
  });

  it("refreshes an access token, keeping the same refresh token client-side", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ access_token: "at_new", expires_in: 3600 }), {
          status: 200,
        }),
      ),
    );

    const refreshed = await refreshAccessToken("rt_existing", "https://fake.test/token");
    expect(refreshed.accessToken).toBe("at_new");
    expect(refreshed.expiresAt).toBeGreaterThan(Date.now());
  });
});

describe("appendRowToSheet (against a fake Sheets API base)", () => {
  it("posts the row and succeeds on a 200", async () => {
    const fetchMock: typeof fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await appendRowToSheet("at_abc", "sheet_123", ["a", "b"], "https://fake.test");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchMock).mock.calls[0]!;
    expect(String(url)).toContain("/v4/spreadsheets/sheet_123/values/A1:append");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer at_abc" });
    expect(JSON.parse(init?.body as string)).toEqual({ values: [["a", "b"]] });
  });

  it("throws SheetsApiError on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("permission denied", { status: 403 })),
    );

    await expect(
      appendRowToSheet("at_abc", "sheet_123", ["a"], "https://fake.test"),
    ).rejects.toThrow(SheetsApiError);
  });
});
