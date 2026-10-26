import { createHash, createHmac } from "node:crypto";
/**
 * Google OAuth (authorization-code flow) for the Sheets integration.
 * This app has no real Google Cloud OAuth client registered — the
 * env vars below are documented in .env.example as needing real
 * values at deploy time (same pattern as CRON_SECRET/RESEND_API_KEY),
 * and `isGoogleOAuthConfigured` lets routes/UI degrade to a clear
 * "not configured" state instead of a broken redirect when they're
 * unset (see DECISIONS.md).
 */

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const DEFAULT_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const DEFAULT_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    process.env.GOOGLE_OAUTH_REDIRECT_URI,
  );
}

/** `state` should be an opaque, server-generated value the callback
 * can verify against (this app uses the target form id — see
 * /api/integrations/google/authorize — since the callback re-checks
 * workspace ownership via RLS anyway, a forged state can at most name
 * a form the attacker's own session has no access to). */
export function buildAuthorizeUrl(
  state: string,
  authEndpoint = DEFAULT_AUTH_ENDPOINT,
  /** PKCE (S256): see pkceForFlow. */
  codeChallenge?: string,
): string {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    throw new Error(
      "Google OAuth is not configured (GOOGLE_OAUTH_CLIENT_ID/REDIRECT_URI)",
    );
  }

  const url = new URL(authEndpoint);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SHEETS_SCOPE);
  url.searchParams.set("access_type", "offline");
  // Google only returns a refresh token on the *first* consent unless
  // this is set — without it, reconnecting after a revoke would leave
  // us with an access token and no way to refresh it.
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  if (codeChallenge) {
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url.toString();
}

/**
 * PKCE for one connect flow: a code verifier only the browser that
 * started the flow can produce (it's derived from that flow's random,
 * httpOnly state cookie and the server secret), so an authorization
 * code intercepted on the way back is useless anywhere else. No extra
 * cookie needed — the callback re-derives it from the same nonce.
 */
export function pkceForFlow(
  cookieNonce: string,
  secret = process.env.APP_SECRET,
): { verifier: string; challenge: string } {
  if (!secret) throw new Error("APP_SECRET is not set");
  const verifier = createHmac("sha256", secret)
    .update(`pkce:${cookieNonce}`)
    .digest("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** Asks Google to revoke a token (disconnecting a sheet). Best effort:
 * the connection is removed on our side either way. */
export async function revokeToken(
  token: string,
  revokeEndpoint = "https://oauth2.googleapis.com/revoke",
): Promise<boolean> {
  try {
    const res = await fetch(revokeEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export type OAuthTokens = {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
};

type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  error?: string;
  error_description?: string;
};

export async function exchangeCodeForTokens(
  code: string,
  tokenEndpoint = DEFAULT_TOKEN_ENDPOINT,
  /** The PKCE verifier for this flow (see pkceForFlow). */
  codeVerifier?: string,
): Promise<OAuthTokens> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth is not configured");
  }

  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
    }),
  });

  const body = (await res.json()) as GoogleTokenResponse;
  if (!res.ok || !body.refresh_token) {
    throw new Error(
      body.error_description || body.error || "Google did not return a refresh token",
    );
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
}

/** Refreshes an expired access token. Google never rotates the
 * refresh token on a plain refresh, so the caller keeps the one it
 * already has. */
export async function refreshAccessToken(
  refreshToken: string,
  tokenEndpoint = DEFAULT_TOKEN_ENDPOINT,
): Promise<{ accessToken: string; expiresAt: number }> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth is not configured");
  }

  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });

  const body = (await res.json()) as GoogleTokenResponse;
  if (!res.ok) {
    throw new Error(
      body.error_description || body.error || "failed to refresh access token",
    );
  }

  return {
    accessToken: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
}

/** True once fewer than 2 minutes of the access token's lifetime
 * remain — refresh a little early rather than racing an in-flight
 * Sheets API call against the exact expiry instant. */
export function needsRefresh(expiresAt: number): boolean {
  return Date.now() > expiresAt - 2 * 60 * 1000;
}
